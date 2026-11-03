-- Hand-written. Tier 1 market-truck hire (TIER1-MARKET-TRUCKS.md §5): privileges, RLS, triggers,
-- number allocation, SQL views, purge helper. Tables come from 0013_hire_tables.sql.
-- Policies reuse the existing permissions (no new actions): masters = master.edit, challans =
-- lr.edit or bill.edit, payments / share links = bill.edit, reads = freight.view (masters: any office role).

-- ---------- privileges: nothing for anon, no deletes (soft cancel only) ----------
revoke all on public.branches, public.vehicle_types, public.charge_types, public.pumps,
  public.truck_parties, public.tds_declarations, public.market_drivers, public.market_vehicles,
  public.hire_number_series, public.challans, public.challan_lrs, public.challan_charges,
  public.truck_payments, public.truck_payment_allocations, public.share_links from anon;
--> statement-breakpoint
revoke delete, truncate on public.branches, public.vehicle_types, public.charge_types, public.pumps,
  public.truck_parties, public.tds_declarations, public.market_drivers, public.market_vehicles,
  public.hire_number_series, public.challans, public.challan_lrs, public.challan_charges,
  public.truck_payments, public.truck_payment_allocations, public.share_links from authenticated;
--> statement-breakpoint
-- Draft challan LR lines can be replaced; counters move only through app.allocate_hire_number.
grant delete on public.challan_lrs to authenticated;
--> statement-breakpoint
revoke insert, update on public.hire_number_series from authenticated;
--> statement-breakpoint

-- ---------- RLS ----------
do $$
declare
  t text;
begin
  -- masters: office roles read, master.edit writes
  foreach t in array array['branches', 'vehicle_types', 'charge_types', 'pumps', 'truck_parties',
                           'tds_declarations', 'market_drivers', 'market_vehicles'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.is_office(company_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.can(company_id, %L))', t || '_insert', t, 'master.edit');
    execute format('create policy %I on public.%I for update to authenticated using (app.can(company_id, %L)) with check (app.can(company_id, %L))', t || '_update', t, 'master.edit', 'master.edit');
  end loop;
  -- challans and their lines / charges
  foreach t in array array['challans', 'challan_lrs', 'challan_charges'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.can(company_id, %L))', t || '_select', t, 'freight.view');
    execute format('create policy %I on public.%I for insert to authenticated with check (app.can(company_id, %L) or app.can(company_id, %L))', t || '_insert', t, 'lr.edit', 'bill.edit');
    execute format('create policy %I on public.%I for update to authenticated using (app.can(company_id, %L) or app.can(company_id, %L)) with check (app.can(company_id, %L) or app.can(company_id, %L))', t || '_update', t, 'lr.edit', 'bill.edit', 'lr.edit', 'bill.edit');
  end loop;
  -- truck payments, allocations, share links
  foreach t in array array['truck_payments', 'truck_payment_allocations', 'share_links'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.can(company_id, %L))', t || '_select', t, 'freight.view');
    execute format('create policy %I on public.%I for insert to authenticated with check (app.can(company_id, %L))', t || '_insert', t, 'bill.edit');
    execute format('create policy %I on public.%I for update to authenticated using (app.can(company_id, %L)) with check (app.can(company_id, %L))', t || '_update', t, 'bill.edit', 'bill.edit');
  end loop;
end $$;
--> statement-breakpoint
create policy hire_number_series_select on public.hire_number_series for select to authenticated
  using (app.is_office(company_id));
--> statement-breakpoint
create policy challan_lrs_delete on public.challan_lrs for delete to authenticated
  using ((app.can(company_id, 'lr.edit') or app.can(company_id, 'bill.edit')) and exists (
    select 1 from public.challans c
     where c.company_id = challan_lrs.company_id and c.id = challan_lrs.challan_id
       and c.status = 'draft' and c.cancelled_at is null));
--> statement-breakpoint

-- ---------- row triggers (same set as 0002: a_stamp, b_cancel_guard, c_bump, z_no_delete) ----------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('branches',           'master.edit',   array[]::text[]),
      ('vehicle_types',      'master.edit',   array[]::text[]),
      ('charge_types',       'master.edit',   array[]::text[]),
      ('pumps',              'master.edit',   array[]::text[]),
      ('truck_parties',      'record.cancel', array['search_text', 'pan_type']),
      ('tds_declarations',   'record.cancel', array[]::text[]),
      ('market_drivers',     'record.cancel', array[]::text[]),
      ('market_vehicles',    'record.cancel', array[]::text[]),
      ('challans',           'record.cancel', array[]::text[]),
      ('challan_charges',    'record.cancel', array[]::text[]),
      ('truck_payments',     'record.cancel', array[]::text[])
    ) as v(tbl, cancel_action, caches)
  loop
    execute format('create trigger a_stamp before insert on public.%I for each row execute function app.tg_stamp_insert()', t.tbl);
    execute format('create trigger b_cancel_guard before update on public.%I for each row execute function app.tg_cancel_guard(%L%s)',
      t.tbl, t.cancel_action, (select coalesce(string_agg(format(', %L', c), ''), '') from unnest(t.caches) c));
    execute format('create trigger c_bump before update on public.%I for each row execute function app.tg_bump_row(%s)',
      t.tbl, (select coalesce(string_agg(format('%L', c), ', '), '') from unnest(t.caches) c));
    execute format('create trigger z_no_delete before delete on public.%I for each row execute function app.tg_no_delete()', t.tbl);
  end loop;
end $$;
--> statement-breakpoint
create trigger z_no_delete before delete on public.hire_number_series
  for each row execute function app.tg_no_delete();
--> statement-breakpoint
create trigger z_no_delete before delete on public.truck_payment_allocations
  for each row execute function app.tg_no_delete();
--> statement-breakpoint
create trigger z_no_delete before delete on public.share_links
  for each row execute function app.tg_no_delete();
--> statement-breakpoint

-- Bank / UPI detail change stamps bank_changed_at (drives the cooling-period alert).
create or replace function app.tg_truck_party_bank_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.bank_name, new.account_no, new.ifsc, new.account_holder, new.upi_id, new.upi_qr_file)
     is distinct from
     (old.bank_name, old.account_no, old.ifsc, old.account_holder, old.upi_id, old.upi_qr_file) then
    new.bank_changed_at := now();
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b2_bank_changed before update on public.truck_parties
  for each row execute function app.tg_truck_party_bank_changed();
--> statement-breakpoint

-- A challan with live payments can't be cancelled; reverse the payments first.
create or replace function app.tg_challan_cancel_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null and exists (
    select 1 from public.truck_payment_allocations a
      join public.truck_payments p on p.company_id = a.company_id and p.id = a.payment_id
     where a.company_id = new.company_id and a.challan_id = new.id
       and p.cancelled_at is null and p.status <> 'reversed') then
    raise exception 'Reverse the payments on this challan before cancelling it'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b2_cancel_check before update on public.challans
  for each row execute function app.tg_challan_cancel_check();
--> statement-breakpoint

-- ---------- number allocation: row lock, never max + 1 (rolls back with the caller) ----------
create or replace function app.allocate_hire_number(company uuid, kind public.hire_series_kind, branch uuid, fy text)
returns table (prefix text, no bigint, padding smallint)
language plpgsql security definer set search_path = '' as $$
declare
  r public.hire_number_series;
begin
  if not app.is_system() and not (
       app.can(company, 'bill.edit') or (kind = 'challan' and app.can(company, 'lr.edit'))) then
    raise exception 'Your role can''t take % numbers', kind using errcode = 'insufficient_privilege';
  end if;
  insert into public.hire_number_series (company_id, doc_type, branch_id, fy)
  values (company, kind, branch, allocate_hire_number.fy)
  on conflict do nothing;
  select * into r from public.hire_number_series s
   where s.company_id = company and s.doc_type = kind and s.branch_id = branch
     and s.fy = allocate_hire_number.fy for update;
  update public.hire_number_series s set next_no = s.next_no + 1, updated_at = now()
   where s.company_id = company and s.doc_type = kind and s.branch_id = branch
     and s.fy = allocate_hire_number.fy;
  return query select r.prefix, r.next_no, r.padding;
end $$;
--> statement-breakpoint
grant execute on function app.allocate_hire_number(uuid, public.hire_series_kind, uuid, text)
  to authenticated, service_role;
--> statement-breakpoint

-- ---------- views (security_invoker: the caller's RLS applies) ----------
-- Per challan: hire, additions / deductions, TDS, paid, balance, margin. Only PAID, live payments count.
create view public.v_challan_balance with (security_invoker = true) as
select x.company_id,
       x.challan_id,
       x.payee_party_id,
       x.challan_at,
       x.hire_amount,
       x.additions,
       x.deductions,
       x.hire_amount + x.additions as gross_credit,
       x.tds_amount,
       x.hire_amount + x.additions - x.deductions - x.tds_amount as net_payable,
       x.advance_paid,
       x.paid,
       x.hire_amount + x.additions - x.deductions - x.tds_amount - x.paid as balance,
       x.trip_revenue,
       x.trip_revenue - (x.hire_amount + x.additions) as margin,
       case when x.trip_revenue > 0
            then round((x.trip_revenue - (x.hire_amount + x.additions)) * 100 / x.trip_revenue, 2) end as margin_pct
  from (
    select c.company_id,
           c.id as challan_id,
           c.payee_party_id,
           c.challan_at,
           c.hire_amount,
           coalesce(ch.additions, 0)::numeric(14,2) as additions,
           coalesce(ch.deductions, 0)::numeric(14,2) as deductions,
           coalesce(pa.tds, 0)::numeric(14,2) as tds_amount,
           coalesce(pa.advance, 0)::numeric(14,2) as advance_paid,
           coalesce(pa.paid, 0)::numeric(14,2) as paid,
           (coalesce(lr.freight, 0) + coalesce(ch.party_billable, 0))::numeric(14,2) as trip_revenue
      from public.challans c
      left join lateral (
        select sum(g.amount) filter (where g.direction = 'add') as additions,
               sum(g.amount) filter (where g.direction = 'deduct') as deductions,
               sum(g.party_amount) filter (where g.bill_party) as party_billable
          from public.challan_charges g
         where g.company_id = c.company_id and g.challan_id = c.id and g.cancelled_at is null
      ) ch on true
      left join lateral (
        select sum(l.freight_allocated) as freight
          from public.challan_lrs l
         where l.company_id = c.company_id and l.challan_id = c.id
           and l.transferred_to_challan_id is null
      ) lr on true
      left join lateral (
        select sum(a.amount) as paid,
               sum(a.amount) filter (where a.kind = 'advance') as advance,
               sum(a.tds_amount) as tds
          from public.truck_payment_allocations a
          join public.truck_payments p on p.company_id = a.company_id and p.id = a.payment_id
         where a.company_id = c.company_id and a.challan_id = c.id
           and p.status = 'paid' and p.cancelled_at is null
      ) pa on true
     where c.cancelled_at is null
  ) x;
--> statement-breakpoint

-- Open hire per payee with aging buckets (days since challan date).
create view public.v_party_hire_outstanding with (security_invoker = true) as
select b.company_id,
       b.payee_party_id as party_id,
       count(*)::int as open_challans,
       sum(b.balance)::numeric(14,2) as outstanding,
       coalesce(sum(b.balance) filter (where age <= 7), 0)::numeric(14,2) as age_0_7,
       coalesce(sum(b.balance) filter (where age between 8 and 15), 0)::numeric(14,2) as age_8_15,
       coalesce(sum(b.balance) filter (where age between 16 and 30), 0)::numeric(14,2) as age_16_30,
       coalesce(sum(b.balance) filter (where age > 30), 0)::numeric(14,2) as age_30_plus
  from (
    select v.*, (current_date - (v.challan_at at time zone 'Asia/Kolkata')::date) as age
      from public.v_challan_balance v
  ) b
 where b.balance > 0 and b.payee_party_id is not null
 group by b.company_id, b.payee_party_id;
--> statement-breakpoint

-- One row per balance allocation that deducted TDS; section label comes from company settings.
create view public.v_tds_register with (security_invoker = true) as
select a.company_id,
       p.id as payment_id,
       p.payment_no,
       p.paid_on,
       app.financial_year(p.paid_on) as fy,
       tp.id as party_id,
       tp.name as party_name,
       tp.pan,
       tp.pan_type,
       a.challan_id,
       c.challan_no,
       v.gross_credit as tds_base,
       a.tds_amount,
       case when v.gross_credit > 0 then round(a.tds_amount * 100 / v.gross_credit, 2) end as tds_percent,
       co.tds_section_label as section_label
  from public.truck_payment_allocations a
  join public.truck_payments p on p.company_id = a.company_id and p.id = a.payment_id
  join public.truck_parties tp on tp.company_id = p.company_id and tp.id = p.payee_party_id
  join public.challans c on c.company_id = a.company_id and c.id = a.challan_id
  join public.v_challan_balance v on v.company_id = a.company_id and v.challan_id = a.challan_id
  join public.companies co on co.id = a.company_id
 where a.tds_amount > 0 and p.status = 'paid' and p.cancelled_at is null;
--> statement-breakpoint

-- Last 10 hires per lane (route + vehicle type + basis): median, last rate, history newest first.
create view public.v_lane_rates with (security_invoker = true) as
select r.company_id,
       r.src as source,
       r.dst as destination,
       r.vehicle_type_id,
       r.rate_basis,
       count(*)::int as n,
       round((percentile_cont(0.5) within group (order by r.rate::float8))::numeric, 2) as median_rate,
       (array_agg(r.rate order by r.challan_at desc))[1] as last_rate,
       max(r.challan_at) as last_at,
       array_agg(r.rate order by r.challan_at desc) as rates
  from (
    select c.company_id,
           lower(trim(c.source)) as src,
           lower(trim(c.destination)) as dst,
           c.vehicle_type_id,
           c.rate_basis,
           c.rate,
           c.challan_at,
           row_number() over (
             partition by c.company_id, lower(trim(c.source)), lower(trim(c.destination)),
                          c.vehicle_type_id, c.rate_basis
             order by c.challan_at desc) as rn
      from public.challans c
     where c.cancelled_at is null and c.rate > 0
       and coalesce(trim(c.source), '') <> '' and coalesce(trim(c.destination), '') <> ''
  ) r
 where r.rn <= 10
 group by r.company_id, r.src, r.dst, r.vehicle_type_id, r.rate_basis;
--> statement-breakpoint
revoke all on public.v_challan_balance, public.v_party_hire_outstanding, public.v_tds_register,
  public.v_lane_rates from anon;
--> statement-breakpoint
grant select on public.v_challan_balance, public.v_party_hire_outstanding, public.v_tds_register,
  public.v_lane_rates to authenticated;
--> statement-breakpoint

-- ---------- company wipe (test / reset helper) must clear the new tables first ----------
do $$
declare
  def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'purge_company' and n.nspname in ('app', 'public') limit 1;
  if def is not null and def not like '%share_links%' then
    execute replace(def,
      'delete from public.audit_log where company_id = company;',
      'delete from public.share_links where company_id = company;' || E'\n  ' ||
      'delete from public.truck_payment_allocations where company_id = company;' || E'\n  ' ||
      'delete from public.truck_payments where company_id = company;' || E'\n  ' ||
      'delete from public.challan_charges where company_id = company;' || E'\n  ' ||
      'delete from public.challan_lrs where company_id = company;' || E'\n  ' ||
      'delete from public.challans where company_id = company;' || E'\n  ' ||
      'delete from public.tds_declarations where company_id = company;' || E'\n  ' ||
      'delete from public.market_vehicles where company_id = company;' || E'\n  ' ||
      'delete from public.market_drivers where company_id = company;' || E'\n  ' ||
      'delete from public.truck_parties where company_id = company;' || E'\n  ' ||
      'delete from public.pumps where company_id = company;' || E'\n  ' ||
      'delete from public.charge_types where company_id = company;' || E'\n  ' ||
      'delete from public.vehicle_types where company_id = company;' || E'\n  ' ||
      'delete from public.hire_number_series where company_id = company;' || E'\n  ' ||
      'delete from public.branches where company_id = company;' || E'\n  ' ||
      'delete from public.audit_log where company_id = company;');
  end if;
end $$;
