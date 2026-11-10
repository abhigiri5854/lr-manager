-- Hand-written. Truck payment workflow (TIER1-MARKET-TRUCKS.md §6 screen 4, §9 decisions 1, 2, 5):
-- voucher number only at approval (payment_no nullable until then), manual TDS %, UPI target,
-- approval / paid / reversal stamps, payee snapshot, status-transition guard, allocations frozen
-- after draft, and the role grants payment.approve (Owner) + payee.bank (never seeded by 0005).
-- v_challan_balance already counts only status = 'paid' payments, so it is unchanged.

-- Hire document number = prefix + number, zero-padded only when padding > 0, never truncated.
-- (Challans used lpad(no, padding), which returns '' for padding 0, the default, so every challan
-- number was just the prefix and the 2nd one hit the unique index.) Used by challans + payments.
create or replace function app.format_hire_number(prefix text, no bigint, padding smallint)
returns text language sql immutable set search_path = '' as $$
  select coalesce(prefix, '') || case when padding > 0
    then lpad(no::text, greatest(padding::int, length(no::text)), '0')
    else no::text end
$$;
--> statement-breakpoint
grant execute on function app.format_hire_number(text, bigint, smallint) to authenticated, service_role;
--> statement-breakpoint

-- Bank-change cooling is off unless the company sets it (null / 0 = off; the column has no
-- default). Owner decision: off for all existing companies.
update public.companies set bank_change_cooling_hours = null;
--> statement-breakpoint

alter table public.truck_payments alter column payment_no drop not null;
--> statement-breakpoint
alter table public.truck_payments
  add column tds_percent numeric(6, 3) not null default 0,
  add column upi_id text,
  add column upi_qr_file text,
  add column payee_snapshot jsonb,
  add column warnings jsonb not null default '[]'::jsonb,
  add column pod_override_reason text,
  add column paid_at timestamp with time zone,
  add column paid_by uuid references public.users(id),
  add column reversed_at timestamp with time zone,
  add column reversed_by uuid references public.users(id),
  add column reversal_reason text;
--> statement-breakpoint
alter table public.truck_payments
  add constraint truck_payments_tds_percent_check check (tds_percent >= 0 and tds_percent <= 100),
  add constraint truck_payments_number_check
    check ((payment_no is null) = (status in ('draft', 'pending_approval'))),
  add constraint truck_payments_cheque_check
    check (mode <> 'cheque' or (ref_no is not null and cheque_date is not null)),
  add constraint truck_payments_paid_check check (status <> 'paid' or paid_at is not null),
  add constraint truck_payments_reversed_check
    check ((status = 'reversed') = (reversed_at is not null) and (reversed_at is null or reversal_reason is not null));
--> statement-breakpoint

-- Status flow: draft → pending_approval → approved → paid; reversed from approved / paid only.
-- Approving above the company's maker-checker limit (or from pending_approval) and reversing need
-- payment.approve. Amounts, payee and mode are fixed once the payment leaves draft.
create or replace function app.tg_truck_payment_flow() returns trigger
language plpgsql set search_path = '' as $$
declare
  lim numeric;
begin
  if app.is_system() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.payment_no is not null or new.approved_by is not null then
      raise exception 'A truck payment starts as a draft' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status in ('pending_approval', 'approved'))
         or (old.status = 'pending_approval' and new.status = 'approved')
         or (old.status = 'approved' and new.status in ('paid', 'reversed'))
         or (old.status = 'paid' and new.status = 'reversed')) then
      raise exception 'A truck payment can''t go from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;
    if new.status = 'reversed' and not app.can(new.company_id, 'payment.approve') then
      raise exception 'Your role can''t reverse truck payments' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'approved' and not app.can(new.company_id, 'payment.approve') then
      select c.maker_checker_limit into lim from public.companies c where c.id = new.company_id;
      if old.status = 'pending_approval' or (lim is not null and new.amount + new.tds_amount > lim) then
        raise exception 'This truck payment needs an approver' using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;
  if old.status <> 'draft'
     and (new.amount, new.tds_amount, new.tds_percent, new.payee_party_id, new.mode, new.pump_id, new.branch_id)
         is distinct from
         (old.amount, old.tds_amount, old.tds_percent, old.payee_party_id, old.mode, old.pump_id, old.branch_id) then
    raise exception 'Amounts, payee and mode are fixed once the payment is submitted'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b3_payment_flow before insert or update on public.truck_payments
  for each row execute function app.tg_truck_payment_flow();
--> statement-breakpoint

-- Allocations can be added / changed only while their payment is a draft.
create or replace function app.tg_truck_allocation_draft_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if app.is_system() then
    return new;
  end if;
  if exists (select 1 from public.truck_payments p
              where p.company_id = new.company_id and p.id = new.payment_id and p.status <> 'draft')
     or (tg_op = 'UPDATE' and exists (
           select 1 from public.truck_payments p
            where p.company_id = old.company_id and p.id = old.payment_id and p.status <> 'draft')) then
    raise exception 'Allocations can change only while the payment is a draft'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b_draft_only before insert or update on public.truck_payment_allocations
  for each row execute function app.tg_truck_allocation_draft_only();
--> statement-breakpoint

-- Keep role_permissions = lib/permissions.ts (db/tests/permissions.test.ts).
insert into public.role_permissions (role, action) values
  ('owner', 'payee.bank'),
  ('accountant', 'payee.bank'),
  ('owner', 'payment.approve')
on conflict do nothing;
