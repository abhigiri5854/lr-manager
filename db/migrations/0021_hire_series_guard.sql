-- Hand-written. Two small hire changes.
--
-- 1. Number series guard (next_no only moves up; company / branch / fy / doc_type can't change).
--    0019 has it at the end, but databases that ran 0019 before it was added never got it (drizzle
--    doesn't re-run a migration), so it is (re)created here. Same function; replace-safe.
--
-- 2. charge_types.bill_column: which freight-bill line column a party-billable POD charge lands in.
--    Replaces the old guess from the code / label ("detention" in either → detention column).
--    The freight bill has detention and other columns only, so 'unloading' is billed under other
--    until the bill gets its own unloading column (lib/data/db/challan-pod.ts addChargesToLines).
create or replace function app.tg_hire_series_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.company_id is distinct from old.company_id
     or new.branch_id is distinct from old.branch_id
     or new.fy is distinct from old.fy
     or new.doc_type is distinct from old.doc_type then
    raise exception 'A number series can''t change its company, branch, financial year or document type'
      using errcode = 'check_violation';
  end if;
  if new.next_no < old.next_no then
    raise exception 'Next number can''t go below % (numbers up to it are already issued)', old.next_no
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
drop trigger if exists b_series_guard on public.hire_number_series;
--> statement-breakpoint
create trigger b_series_guard before update on public.hire_number_series
  for each row execute function app.tg_hire_series_guard();
--> statement-breakpoint
create type public.charge_bill_column as enum ('detention', 'unloading', 'other');
--> statement-breakpoint
alter table public.charge_types
  add column bill_column public.charge_bill_column not null default 'other';
--> statement-breakpoint
-- Existing types keep the column the guess gave them.
update public.charge_types set bill_column = 'detention'
 where (code || ' ' || label) ~* 'detention' and bill_column <> 'detention';
--> statement-breakpoint

-- 3. LR POD → challan sync (lib/data/db/challan-pod.ts syncChallanFromLrPod).
-- The live, dispatched challans carrying an LR, for whoever may record that LR's POD (a driver can't
-- read challans under RLS, but must still be refused when the challan is settled). No money columns.
create or replace function app.lr_live_challans(company uuid, lr uuid)
returns table (id uuid, challan_no text, status text, version integer, reported_at timestamptz,
               unloaded_at timestamptz, pod_received_at timestamptz, loaded_pkgs integer,
               delivered_pkgs integer, other_delivered integer)
language sql stable security definer set search_path = '' as $$
  select c.id, c.challan_no, c.status::text, c.version::integer, c.reported_at, c.unloaded_at,
         c.pod_received_at, cl.loaded_pkgs::integer, cl.delivered_pkgs::integer,
         (select coalesce(sum(o.delivered_pkgs), 0)::integer
            from public.challan_lrs o
            join public.challans oc on oc.company_id = o.company_id and oc.id = o.challan_id
           where o.company_id = cl.company_id and o.lr_id = cl.lr_id and o.challan_id <> cl.challan_id
             and oc.cancelled_at is null and o.transferred_to_challan_id is null)
    from public.challan_lrs cl
    join public.challans c on c.company_id = cl.company_id and c.id = cl.challan_id
   where cl.company_id = company and cl.lr_id = lr and cl.transferred_to_challan_id is null
     and c.cancelled_at is null and c.status <> 'draft'
     and exists (select 1 from app.lr_pod_info(company, lr))
   order by c.challan_no;
$$;
--> statement-breakpoint
revoke execute on function app.lr_live_challans(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function app.lr_live_challans(uuid, uuid) to authenticated, service_role;
--> statement-breakpoint

-- A driver's LR POD save → its challan's unloading / POD-received dates, status and delivered
-- packages, read from the LR and its POD as just written (nothing passed in can set them). Office users
-- go through the app (which also recomputes the late-POD fee and shortage); this is the driver path.
create or replace function app.sync_challan_pod_from_lr(company uuid, lr uuid, challan uuid)
returns table (changed boolean, status text, reported_at timestamptz, unloaded_at timestamptz,
               pod_received_at timestamptz, delivered_pkgs integer)
language plpgsql security definer set search_path = '' as $$
declare
  c public.challans%rowtype;
  line public.challan_lrs%rowtype;
  delivered_on date;
  p_received timestamptz;
  p_pkgs integer;
  has_pod boolean;
  other_pkgs integer;
  new_unloaded timestamptz;
  new_received timestamptz;
  new_status text;
  new_pkgs integer;
begin
  if not exists (select 1 from app.lr_pod_info(company, lr)) then
    raise exception 'You can only record POD for your own trips' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.challans x where x.company_id = company and x.id = challan for update;
  if not found or c.cancelled_at is not null or c.status = 'draft' then
    return query select false, c.status::text, c.reported_at, c.unloaded_at, c.pod_received_at, null::integer;
    return;
  end if;
  if c.status = 'settled' then
    raise exception 'Challan % is settled; reopen it to change POD', c.challan_no using errcode = 'check_violation';
  end if;
  select * into line from public.challan_lrs x
   where x.company_id = company and x.challan_id = challan and x.lr_id = lr
     and x.transferred_to_challan_id is null;
  if not found then
    return query select false, c.status::text, c.reported_at, c.unloaded_at, c.pod_received_at, null::integer;
    return;
  end if;

  select (l.delivered_at at time zone 'utc')::date into delivered_on
    from public.lrs l where l.company_id = company and l.id = lr;
  select true, p.received_at, p.packages_received into has_pod, p_received, p_pkgs
    from public.pods p where p.company_id = company and p.lr_id = lr and p.cancelled_at is null;

  -- Same rules as the app: delivered on (India date) = unloading date; keep the time if same day.
  new_unloaded := case
    when delivered_on is null then c.unloaded_at
    when c.unloaded_at is not null and (c.unloaded_at at time zone 'Asia/Kolkata')::date = delivered_on
      then c.unloaded_at
    else delivered_on::timestamp at time zone 'Asia/Kolkata' end;
  new_received := case when coalesce(has_pod, false) then p_received else c.pod_received_at end;
  new_status := case when new_received is not null then 'pod_received'
                     when c.status = 'pod_received' then 'dispatched'
                     else c.status::text end;
  new_pkgs := line.delivered_pkgs;
  if p_pkgs is not null then
    select coalesce(sum(o.delivered_pkgs), 0)::integer into other_pkgs
      from public.challan_lrs o
      join public.challans oc on oc.company_id = o.company_id and oc.id = o.challan_id
     where o.company_id = company and o.lr_id = lr and o.challan_id <> challan
       and oc.cancelled_at is null and o.transferred_to_challan_id is null;
    new_pkgs := p_pkgs - other_pkgs;
    if new_pkgs < 0 or new_pkgs > line.loaded_pkgs then
      raise exception 'Challan % loaded % packages of this LR', c.challan_no, line.loaded_pkgs
        using errcode = 'check_violation';
    end if;
  end if;
  if c.reported_at is not null and new_unloaded is not null and new_unloaded < c.reported_at then
    raise exception 'Unloaded can''t be before reported' using errcode = 'check_violation';
  end if;
  if new_received is not null and new_unloaded is not null and new_received < new_unloaded then
    raise exception 'POD received can''t be before unloading' using errcode = 'check_violation';
  end if;

  if (new_unloaded, new_received, new_status) is distinct from (c.unloaded_at, c.pod_received_at, c.status::text) then
    update public.challans x
       set unloaded_at = new_unloaded, pod_received_at = new_received,
           status = new_status::public.challan_status
     where x.company_id = company and x.id = challan;
  end if;
  if new_pkgs is distinct from line.delivered_pkgs then
    update public.challan_lrs x set delivered_pkgs = new_pkgs
     where x.company_id = company and x.challan_id = challan and x.lr_id = lr
       and x.transferred_to_challan_id is null;
  end if;
  return query select
    ((new_unloaded, new_received, new_status, new_pkgs)
       is distinct from (c.unloaded_at, c.pod_received_at, c.status::text, line.delivered_pkgs)),
    new_status, c.reported_at, new_unloaded, new_received, new_pkgs;
end $$;
--> statement-breakpoint
revoke execute on function app.sync_challan_pod_from_lr(uuid, uuid, uuid) from public;
--> statement-breakpoint
grant execute on function app.sync_challan_pod_from_lr(uuid, uuid, uuid) to authenticated, service_role;
