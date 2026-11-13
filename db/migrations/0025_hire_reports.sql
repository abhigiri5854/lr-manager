-- Hire reports (/market-trucks/reports). Hand-written.
-- v_tds_register (0014) was not usable for the TDS register report:
--   * tds_percent divided the allocation's TDS by the WHOLE challan credit, so a part payment showed a wrong %;
--   * allocations with 0% TDS were missing, so a declared (194C(6)) party never appeared;
--   * no gross / net per allocation and no quarter.
-- Same leading columns as before (other readers keep working); new ones are appended.
-- v_challan_balance, v_party_hire_outstanding and v_lane_rates are unchanged: balance matches the challan
-- register, and the other reports aggregate v_challan_balance / challans directly.
create or replace view public.v_tds_register with (security_invoker = true) as
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
       -- TDS as a share of what this allocation settled (cash paid + TDS held back).
       case when a.amount + a.tds_amount > 0
            then round(a.tds_amount * 100 / (a.amount + a.tds_amount), 2) end as tds_percent,
       co.tds_section_label as section_label,
       a.id as allocation_id,
       a.kind as allocation_kind,
       (a.amount + a.tds_amount)::numeric(14,2) as gross_amount,
       a.amount as net_amount,
       'Q' || ((extract(month from p.paid_on)::int + 8) % 12 / 3 + 1) as quarter,
       coalesce(dd.ok, false) as has_declaration
  from public.truck_payment_allocations a
  join public.truck_payments p on p.company_id = a.company_id and p.id = a.payment_id
  join public.truck_parties tp on tp.company_id = p.company_id and tp.id = p.payee_party_id
  join public.challans c on c.company_id = a.company_id and c.id = a.challan_id
  join public.v_challan_balance v on v.company_id = a.company_id and v.challan_id = a.challan_id
  join public.companies co on co.id = a.company_id
  left join lateral (
    select true as ok
      from public.tds_declarations d
     where d.company_id = p.company_id and d.party_id = tp.id
       and d.fy = app.financial_year(p.paid_on) and d.cancelled_at is null
     limit 1
  ) dd on true
 where p.status = 'paid' and p.cancelled_at is null
   and (a.tds_amount > 0 or (a.kind = 'balance' and dd.ok is not null));
