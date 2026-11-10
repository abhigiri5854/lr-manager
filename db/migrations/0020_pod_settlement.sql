-- Hand-written. T1-07 POD settlement data layer (TIER1-MARKET-TRUCKS.md §4, §6 screen 3, §9 #3/#4).
-- Payments are optional: nothing here looks at truck_payments.
--  * challan_charges: system lines (late-POD fee, shortage) carry auto_kind + auto_amount; the user may
--    override the amount with a reason. They need no charge type (none is seeded for them).
--  * Party-billable lines name their LR (the bill party comes from it) and are billed once:
--    billed_in_freight_bill_id can only move off a CANCELLED bill, and a billed line's money is frozen.
--  * Settled challans: POD fields, delivered packages and POD charges are locked; only billing may
--    change. Reopening needs record.cancel + a reason.

create type public.pod_auto_kind as enum ('late_pod', 'shortage');
--> statement-breakpoint
alter table public.companies add column shortage_auto boolean not null default false;
--> statement-breakpoint
alter table public.challans
  add column reopened_at timestamptz,
  add column reopen_reason text;
--> statement-breakpoint
alter table public.challans
  add constraint challans_reopen_check check ((reopened_at is null) = (reopen_reason is null));
--> statement-breakpoint
alter table public.challans
  add constraint challans_pod_status_check
  check (status not in ('pod_received', 'settled') or pod_received_at is not null) not valid;
--> statement-breakpoint
alter table public.challans
  add constraint challans_settled_check check (status <> 'settled' or settled_at is not null) not valid;
--> statement-breakpoint
alter table public.challan_lrs
  add constraint challan_lrs_delivered_check
  check (delivered_pkgs is null or delivered_pkgs <= loaded_pkgs) not valid;
--> statement-breakpoint
alter table public.challan_charges
  alter column charge_type_id drop not null,
  add column auto_kind public.pod_auto_kind,
  add column auto_amount numeric(14, 2),
  add column override_reason text;
--> statement-breakpoint
alter table public.challan_charges
  add constraint challan_charges_type_check check (charge_type_id is not null or auto_kind is not null);
--> statement-breakpoint
alter table public.challan_charges
  add constraint challan_charges_auto_check check (
    (auto_kind is null) = (auto_amount is null)
    and (auto_amount is null or auto_amount >= 0)
    and (override_reason is null or auto_kind is not null)
    and (auto_kind is null or stage = 'pod'));
--> statement-breakpoint
alter table public.challan_charges
  add constraint challan_charges_party_lr_check check (not bill_party or lr_id is not null) not valid;
--> statement-breakpoint
create unique index challan_charges_auto_key on public.challan_charges
  (company_id, challan_id, auto_kind, coalesce(lr_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where auto_kind is not null and cancelled_at is null;
--> statement-breakpoint
create index challan_charges_bill_idx on public.challan_charges (company_id, billed_in_freight_bill_id)
  where billed_in_freight_bill_id is not null;
--> statement-breakpoint

-- ---------- billed once + settled lock on charges ----------
create or replace function app.tg_challan_charge_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  is_settled boolean;
  bill_live boolean := false;
  keep text[] := array['billed_in_freight_bill_id', 'version', 'updated_at', 'updated_by'];
begin
  select c.status = 'settled' into is_settled from public.challans c
   where c.company_id = new.company_id and c.id = new.challan_id;
  if tg_op = 'INSERT' then
    if coalesce(is_settled, false) then
      raise exception 'This challan is settled — reopen it to change POD charges'
        using errcode = 'check_violation';
    end if;
    if new.billed_in_freight_bill_id is not null then
      raise exception 'A new charge can''t start out billed' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.billed_in_freight_bill_id is not null then
    select b.cancelled_at is null into bill_live from public.freight_bills b
     where b.company_id = old.company_id and b.id = old.billed_in_freight_bill_id;
    bill_live := coalesce(bill_live, false);
  end if;
  if bill_live then
    if new.billed_in_freight_bill_id is distinct from old.billed_in_freight_bill_id then
      raise exception 'This charge is already on a freight bill' using errcode = 'check_violation';
    end if;
    if (new.bill_party, new.party_amount, new.lr_id, new.challan_id, new.cancelled_at)
       is distinct from (old.bill_party, old.party_amount, old.lr_id, old.challan_id, old.cancelled_at) then
      raise exception 'This charge is on a freight bill — cancel the bill before changing it'
        using errcode = 'check_violation';
    end if;
  end if;
  if coalesce(is_settled, false) and (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep) then
    raise exception 'This challan is settled — reopen it to change POD charges'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b3_charge_guard before insert or update on public.challan_charges
  for each row execute function app.tg_challan_charge_guard();
--> statement-breakpoint

-- ---------- delivered packages are locked once settled ----------
create or replace function app.tg_challan_lr_settled_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.challans c
              where c.company_id = new.company_id and c.id = new.challan_id and c.status = 'settled') then
    raise exception 'This challan is settled — reopen it to change delivered packages'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b3_settled_guard before update on public.challan_lrs
  for each row when (new.delivered_pkgs is distinct from old.delivered_pkgs)
  execute function app.tg_challan_lr_settled_guard();
--> statement-breakpoint

-- ---------- challan status: settle only from pod_received; reopen = record.cancel + reason ----------
create or replace function app.tg_challan_settle_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'settled' and new.status = 'settled'
     and (new.reported_at, new.unloaded_at, new.pod_received_at, new.late_pod_days, new.late_pod_fee)
         is distinct from
         (old.reported_at, old.unloaded_at, old.pod_received_at, old.late_pod_days, old.late_pod_fee) then
    raise exception 'This challan is settled — reopen it to change the POD details'
      using errcode = 'check_violation';
  end if;
  if old.status = 'settled' and new.status <> 'settled' then
    if not app.can(new.company_id, 'record.cancel') then
      raise exception 'Your role can''t reopen a settled challan' using errcode = 'insufficient_privilege';
    end if;
    if new.reopened_at is not distinct from old.reopened_at
       or nullif(btrim(coalesce(new.reopen_reason, '')), '') is null then
      raise exception 'Give a reason to reopen a settled challan' using errcode = 'check_violation';
    end if;
  end if;
  if new.status = 'settled' and old.status <> 'settled' and old.status <> 'pod_received' then
    raise exception 'Only a challan with its POD received can be settled' using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b3_settle_guard before update on public.challans
  for each row execute function app.tg_challan_settle_guard();
