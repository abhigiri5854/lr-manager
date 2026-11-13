-- Hand-written. Truck-owner statement links: a truck party's read-only WhatsApp link (no login).
--
-- Reuses share_links (0013) the way driver_links (0023) works: only the SHA-256 of the token is matched;
-- the token itself is kept AES-GCM encrypted with DRIVER_LINK_SECRET (lib/driver-link.ts) so the owner
-- can resend the same link. The party side never touches tables: the server calls
-- app.party_statement(hash, from, to) as service_role. It returns null when the link is missing, revoked
-- or expired and never returns party freight, consignor / consignee freight or margin.

alter table public.share_links add column token_enc text;
--> statement-breakpoint
-- Links made before this migration have no recoverable token: end them (the owner makes a new one).
update public.share_links set revoked_at = now() where revoked_at is null and token_enc is null;
--> statement-breakpoint
alter table public.share_links
  add constraint share_links_enc_check
  check (coalesce(token_enc ~ '^v1\.', false) or revoked_at is not null);
--> statement-breakpoint
-- Max one active (not revoked) link per party.
create unique index share_links_active_key on public.share_links (company_id, party_id)
  where revoked_at is null;
--> statement-breakpoint

-- ---------- privileges + RLS (master.edit manages links; nothing for anon; no deletes) ----------
revoke all on public.share_links from anon;
--> statement-breakpoint
grant select, insert, update on public.share_links to authenticated;
--> statement-breakpoint
revoke delete, truncate on public.share_links from authenticated;
--> statement-breakpoint
-- Replace the 0014 policies (freight.view read, bill.edit write) rather than adding parallel ones:
-- office users of the company read; insert / update only with master.edit; no delete policy.
drop policy share_links_select on public.share_links;
--> statement-breakpoint
drop policy share_links_insert on public.share_links;
--> statement-breakpoint
drop policy share_links_update on public.share_links;
--> statement-breakpoint
create policy share_links_select on public.share_links for select to authenticated
  using (app.is_office(company_id));
--> statement-breakpoint
create policy share_links_insert on public.share_links for insert to authenticated
  with check (app.can(company_id, 'master.edit'));
--> statement-breakpoint
create policy share_links_update on public.share_links for update to authenticated
  using (app.can(company_id, 'master.edit')) with check (app.can(company_id, 'master.edit'));
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.share_links'::regclass and tgname = 'z_no_delete') then
    create trigger z_no_delete before delete on public.share_links
      for each row execute function app.tg_no_delete();
  end if;
end $$;
--> statement-breakpoint

-- A link is only ever revoked (once) or stamped as opened; anything else = make a new link.
create or replace function app.tg_share_link_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not app.is_system() and
     (new.id, new.company_id, new.party_id, new.token_hash, new.token_enc, new.expires_at,
      new.created_at, new.created_by)
     is distinct from
     (old.id, old.company_id, old.party_id, old.token_hash, old.token_enc, old.expires_at,
      old.created_at, old.created_by) then
    raise exception 'A statement link can only be revoked; make a new one instead'
      using errcode = 'check_violation';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'This statement link is already revoked' using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b_stmt_link_guard before update on public.share_links
  for each row execute function app.tg_share_link_guard();
--> statement-breakpoint

-- ---------- internal helper: the live link for a token hash ----------
-- Not revoked, not expired, party and company not cancelled.
create or replace function app.party_statement_link_resolve(p_hash text)
returns table (link_id uuid, company_id uuid, party_id uuid)
language sql stable security definer set search_path = '' as $$
  select l.id, l.company_id, l.party_id
    from public.share_links l
    join public.truck_parties p on p.company_id = l.company_id and p.id = l.party_id
    join public.companies c on c.id = l.company_id
   where l.token_hash = p_hash and l.revoked_at is null and l.expires_at > now()
     and p.cancelled_at is null and c.cancelled_at is null;
$$;
--> statement-breakpoint
revoke execute on function app.party_statement_link_resolve(text) from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- statement API (service_role only) ----------
-- Header, the party's own challans dated in [p_from, p_to] (non-draft, non-cancelled), the paid payments
-- dated in the period, period totals, and the balance outstanding over ALL time. Stamps last_opened_at.
-- Money is text with 2 decimals. Per challan, hire / additions / deductions / tds / paid / balance are
-- taken as-is from v_challan_balance (never recomputed here); balanceOutstanding = sum of its balance over
-- the party's live (non-draft, non-cancelled) challans.
-- Selects only those six view columns: never trip_revenue / margin, party_amount or LR freight.
create or replace function app.party_statement(p_hash text, p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  hdr jsonb;
  ch_json jsonb;
  tot jsonb;
  outstanding text;
  pay_json jsonb;
begin
  select * into k from app.party_statement_link_resolve(p_hash);
  if not found then
    return null;
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'From date can''t be after To date' using errcode = 'check_violation';
  end if;
  update public.share_links set last_opened_at = now() where id = k.link_id;

  select jsonb_build_object('partyName', p.name, 'companyName', c.name,
                            'officePhone', coalesce(c.mobile1, c.mobile2))
    into hdr
    from public.truck_parties p join public.companies c on c.id = p.company_id
   where p.company_id = k.company_id and p.id = k.party_id;

  with ch as (
    select c.id, c.challan_no, c.challan_at,
           (c.challan_at at time zone 'Asia/Kolkata')::date as challan_date,
           v.vehicle_no, c.source, c.destination, c.hire_amount, c.status::text as status,
           (c.pod_received_at at time zone 'Asia/Kolkata')::date as pod_date
      from public.challans c
      left join public.market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
     where c.company_id = k.company_id and c.payee_party_id = k.party_id
       and c.cancelled_at is null and c.status <> 'draft'
  ), calc as (
    select ch.*, b.hire_amount as v_hire, b.additions as adds, b.deductions as deds,
           b.tds_amount as tds, b.paid as paid, b.balance as balance,
           (ch.challan_date between p_from and p_to) as in_period
      from ch
      join public.v_challan_balance b on b.company_id = k.company_id and b.challan_id = ch.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
             'challanNo', calc.challan_no, 'date', calc.challan_date, 'vehicleNo', calc.vehicle_no,
             'source', calc.source, 'destination', calc.destination,
             'hire', calc.v_hire::numeric(14, 2)::text,
             'additions', calc.adds::numeric(14, 2)::text,
             'deductions', calc.deds::numeric(14, 2)::text,
             'tds', calc.tds::numeric(14, 2)::text,
             'paid', calc.paid::numeric(14, 2)::text,
             'balance', calc.balance::numeric(14, 2)::text,
             'status', calc.status, 'podReceivedOn', calc.pod_date)
           order by calc.challan_at, calc.id) filter (where calc.in_period), '[]'::jsonb),
         jsonb_build_object(
           'hire', coalesce(sum(calc.v_hire) filter (where calc.in_period), 0)::numeric(14, 2)::text,
           'additions', coalesce(sum(calc.adds) filter (where calc.in_period), 0)::numeric(14, 2)::text,
           'deductions', coalesce(sum(calc.deds) filter (where calc.in_period), 0)::numeric(14, 2)::text,
           'tds', coalesce(sum(calc.tds) filter (where calc.in_period), 0)::numeric(14, 2)::text,
           'paid', coalesce(sum(calc.paid) filter (where calc.in_period), 0)::numeric(14, 2)::text,
           'balance', coalesce(sum(calc.balance) filter (where calc.in_period), 0)::numeric(14, 2)::text),
         coalesce(sum(calc.balance), 0)::numeric(14, 2)::text
    into ch_json, tot, outstanding
    from calc;

  select coalesce(jsonb_agg(jsonb_build_object(
             'voucherNo', p.payment_no, 'date', p.paid_on, 'mode', p.mode::text, 'reference', p.ref_no,
             'gross', p.amount::numeric(14, 2)::text,
             'tds', p.tds_amount::numeric(14, 2)::text,
             'net', (p.amount - p.tds_amount)::numeric(14, 2)::text,
             'challans', coalesce((
                select jsonb_agg(d.no order by d.no)
                  from (select distinct c.challan_no as no
                          from public.truck_payment_allocations a
                          join public.challans c on c.company_id = a.company_id and c.id = a.challan_id
                         where a.company_id = p.company_id and a.payment_id = p.id
                           and c.payee_party_id = k.party_id and c.cancelled_at is null
                           and c.status <> 'draft') d), '[]'::jsonb))
           order by p.paid_on, p.payment_no, p.id), '[]'::jsonb)
    into pay_json
    from public.truck_payments p
   where p.company_id = k.company_id and p.payee_party_id = k.party_id
     and p.status = 'paid' and p.cancelled_at is null
     and p.paid_on between p_from and p_to;

  return jsonb_build_object('header', hdr, 'from', p_from, 'to', p_to, 'challans', ch_json,
                            'payments', pay_json, 'totals', tot, 'balanceOutstanding', outstanding);
end $$;
--> statement-breakpoint
revoke execute on function app.party_statement(text, date, date) from public, anon, authenticated;
--> statement-breakpoint
grant execute on function app.party_statement(text, date, date) to service_role;
--> statement-breakpoint

-- Owner side: is the party's link live, when it was made / opened. Never returns the token. freight.view.
create or replace function app.party_statement_link_status(p_company uuid, p_party uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.share_links%rowtype;
begin
  if not app.can(p_company, 'freight.view') then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into l from public.share_links x
   where x.company_id = p_company and x.party_id = p_party
   order by x.created_at desc limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'status', case when l.revoked_at is not null then 'revoked'
                   when l.expires_at <= now() then 'expired' else 'active' end,
    'createdAt', l.created_at, 'lastOpenedAt', l.last_opened_at, 'expiresAt', l.expires_at);
end $$;
--> statement-breakpoint
revoke execute on function app.party_statement_link_status(uuid, uuid) from public, anon;
--> statement-breakpoint
grant execute on function app.party_statement_link_status(uuid, uuid) to authenticated;
