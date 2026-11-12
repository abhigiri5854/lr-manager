-- Hand-written. Driver links: a market driver's personal WhatsApp link (no login).
--
-- driver_links  one live link per market driver; only the SHA-256 of the token is matched, the token
--               itself is kept AES-GCM encrypted with DRIVER_LINK_SECRET (lib/driver-link.ts) so the
--               owner can resend the same link.
-- trip_events   loaded / en_route / reached per challan, from office staff or from the driver's link
--               (one row per challan + type + source; repeating updates time / location).
--
-- The driver side never touches tables: the server calls the app.driver_* functions below as
-- service_role with the token HASH. Each returns nothing (null / no rows) when the link is missing,
-- revoked or expired, works only on that driver's own challans, and never returns hire, freight,
-- margin or balance. POD from the link reuses the LR POD + app.sync_challan_pod_core (same rules as
-- the driver-app path in lib/data/db/challan-pod.ts syncChallanFromLrPod).

create type public.trip_event_type as enum ('loaded', 'en_route', 'reached');
--> statement-breakpoint
create type public.trip_event_source as enum ('staff', 'driver_link');
--> statement-breakpoint

create table public.driver_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  market_driver_id uuid not null,
  token_hash text not null,
  token_enc text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_opened_at timestamptz,
  -- Last seen: the phone's last background ping (app.driver_ping), at most one per 5 minutes.
  last_lat numeric(9, 6),
  last_lng numeric(9, 6),
  last_accuracy_m numeric(9, 1),
  last_located_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  constraint driver_links_company_id_id_key unique (company_id, id),
  constraint driver_links_last_geo_check check (
    (last_lat is null) = (last_lng is null) and (last_lat is null) = (last_located_at is null)
    and (last_lat is null or (last_lat between -90 and 90 and last_lng between -180 and 180))
    and (last_accuracy_m is null or last_accuracy_m >= 0)),
  constraint driver_links_driver_fk foreign key (company_id, market_driver_id)
    references public.market_drivers (company_id, id),
  constraint driver_links_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint driver_links_enc_check check (token_enc ~ '^v1\.')
);
--> statement-breakpoint
create unique index driver_links_token_key on public.driver_links (token_hash);
--> statement-breakpoint
-- Max one active (not revoked) link per driver.
create unique index driver_links_active_key on public.driver_links (company_id, market_driver_id)
  where revoked_at is null;
--> statement-breakpoint

create table public.trip_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  challan_id uuid not null,
  type public.trip_event_type not null,
  at timestamptz not null default now(),
  lat numeric(9, 6),
  lng numeric(9, 6),
  accuracy_m numeric(9, 1),
  source public.trip_event_source not null,
  driver_link_id uuid,
  created_by uuid references public.users (id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_events_challan_fk foreign key (company_id, challan_id)
    references public.challans (company_id, id),
  constraint trip_events_link_fk foreign key (company_id, driver_link_id)
    references public.driver_links (company_id, id),
  constraint trip_events_geo_check check (
    (lat is null) = (lng is null)
    and (lat is null or (lat between -90 and 90 and lng between -180 and 180))
    and (accuracy_m is null or accuracy_m >= 0)),
  -- A driver's event carries its link (location optional: phone GPS may be off); a staff event has no link.
  constraint trip_events_source_check check ((source = 'driver_link') = (driver_link_id is not null)),
  constraint trip_events_note_check check (note is null or length(note) <= 500)
);
--> statement-breakpoint
create unique index trip_events_one_key on public.trip_events (company_id, challan_id, type, source);
--> statement-breakpoint
create index trip_events_link_idx on public.trip_events (company_id, driver_link_id)
  where driver_link_id is not null;
--> statement-breakpoint

-- ---------- privileges + RLS: nothing for anon, no deletes ----------
alter table public.driver_links enable row level security;
--> statement-breakpoint
alter table public.trip_events enable row level security;
--> statement-breakpoint
revoke all on public.driver_links, public.trip_events from anon;
--> statement-breakpoint
revoke delete, truncate on public.driver_links, public.trip_events from authenticated;
--> statement-breakpoint
create policy driver_links_select on public.driver_links for select to authenticated
  using (app.can(company_id, 'master.edit'));
--> statement-breakpoint
create policy driver_links_insert on public.driver_links for insert to authenticated
  with check (app.can(company_id, 'master.edit'));
--> statement-breakpoint
create policy driver_links_update on public.driver_links for update to authenticated
  using (app.can(company_id, 'master.edit')) with check (app.can(company_id, 'master.edit'));
--> statement-breakpoint
create policy trip_events_select on public.trip_events for select to authenticated
  using (app.is_office(company_id));
--> statement-breakpoint
create policy trip_events_insert on public.trip_events for insert to authenticated
  with check (app.is_office(company_id) and source = 'staff' and driver_link_id is null);
--> statement-breakpoint
create policy trip_events_update on public.trip_events for update to authenticated
  using (app.is_office(company_id) and source = 'staff')
  with check (app.is_office(company_id) and source = 'staff' and driver_link_id is null);
--> statement-breakpoint
create trigger z_no_delete before delete on public.driver_links
  for each row execute function app.tg_no_delete();
--> statement-breakpoint
create trigger z_no_delete before delete on public.trip_events
  for each row execute function app.tg_no_delete();
--> statement-breakpoint

-- A link is only ever revoked (once) or stamped as opened; anything else = make a new link.
create or replace function app.tg_driver_link_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not app.is_system() and
     (new.id, new.company_id, new.market_driver_id, new.token_hash, new.token_enc, new.expires_at,
      new.created_at, new.created_by)
     is distinct from
     (old.id, old.company_id, old.market_driver_id, old.token_hash, old.token_enc, old.expires_at,
      old.created_at, old.created_by) then
    raise exception 'A driver link can only be revoked; make a new one instead'
      using errcode = 'check_violation';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'This driver link is already revoked' using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b_link_guard before update on public.driver_links
  for each row execute function app.tg_driver_link_guard();
--> statement-breakpoint
create or replace function app.tg_trip_event_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.company_id, new.challan_id, new.type, new.source)
     is distinct from (old.company_id, old.challan_id, old.type, old.source) then
    raise exception 'A trip event can''t move to another challan, type or source'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
--> statement-breakpoint
create trigger b_event_guard before update on public.trip_events
  for each row execute function app.tg_trip_event_guard();
--> statement-breakpoint

-- ---------- LR POD → challan sync, split so the driver-link path can reuse it ----------
-- app.sync_challan_pod_core = the body of 0021's app.sync_challan_pod_from_lr without the caller check
-- (no grants: only definer functions call it). sync_challan_pod_from_lr keeps its check and contract.
create or replace function app.sync_challan_pod_core(company uuid, lr uuid, challan uuid)
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
revoke execute on function app.sync_challan_pod_core(uuid, uuid, uuid) from public, anon, authenticated, service_role;
--> statement-breakpoint
create or replace function app.sync_challan_pod_from_lr(company uuid, lr uuid, challan uuid)
returns table (changed boolean, status text, reported_at timestamptz, unloaded_at timestamptz,
               pod_received_at timestamptz, delivered_pkgs integer)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app.lr_pod_info(company, lr)) then
    raise exception 'You can only record POD for your own trips' using errcode = 'insufficient_privilege';
  end if;
  return query select * from app.sync_challan_pod_core(company, lr, challan);
end $$;
--> statement-breakpoint

-- ---------- company setting: how far back the driver's history page goes ----------
alter table public.companies
  add column driver_history_days integer not null default 90,
  add constraint companies_driver_history_days_check check (driver_history_days between 1 and 3650);
--> statement-breakpoint

-- ---------- driver-link helpers (internal: no grants) ----------
-- The live link for a token hash: not revoked, not expired, driver and company not cancelled.
create or replace function app.driver_link_resolve(p_hash text)
returns table (link_id uuid, company_id uuid, driver_id uuid)
language sql stable security definer set search_path = '' as $$
  select l.id, l.company_id, l.market_driver_id
    from public.driver_links l
    join public.market_drivers d on d.company_id = l.company_id and d.id = l.market_driver_id
    join public.companies c on c.id = l.company_id
   where l.token_hash = p_hash and l.revoked_at is null
     and (l.expires_at is null or l.expires_at > now())
     and d.cancelled_at is null and c.cancelled_at is null;
$$;
--> statement-breakpoint
revoke execute on function app.driver_link_resolve(text) from public, anon, authenticated, service_role;
--> statement-breakpoint
-- audit_log row for a driver-link write: actor system (no user), reason names the link.
create or replace function app.driver_link_audit(p_company uuid, p_link uuid, p_table text, p_record uuid,
                                                 p_action text, p_changes jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (company_id, actor, user_id, table_name, record_id, action, reason, changes)
  select p_company, 'system', null, p_table, p_record, p_action::public.audit_action,
         'Driver link ' || p_link::text, p_changes
   where jsonb_array_length(p_changes) > 0;
$$;
--> statement-breakpoint
revoke execute on function app.driver_link_audit(uuid, uuid, text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
-- [{field, old, new}] for the keys whose value changed (same shape as lib/data auditChanges).
create or replace function app.json_changes(p_old jsonb, p_new jsonb)
returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('field', k, 'old', coalesce(p_old -> k, 'null'::jsonb),
                                               'new', coalesce(p_new -> k, 'null'::jsonb)) order by k),
                  '[]'::jsonb)
    from (select jsonb_object_keys(coalesce(p_old, '{}'::jsonb) || coalesce(p_new, '{}'::jsonb)) as k) keys
   where (p_old -> k) is distinct from (p_new -> k);
$$;
--> statement-breakpoint
revoke execute on function app.json_changes(jsonb, jsonb) from public, anon, authenticated, service_role;
--> statement-breakpoint
-- The driver's own live challan (locked); null when it isn't theirs / is cancelled / still a draft.
-- A settled challan raises (the driver sees it read-only).
create or replace function app.driver_link_challan(p_company uuid, p_driver uuid, p_challan uuid)
returns public.challans
language plpgsql security definer set search_path = '' as $$
declare
  c public.challans%rowtype;
begin
  select * into c from public.challans x
   where x.company_id = p_company and x.id = p_challan and x.driver_id = p_driver
     and x.cancelled_at is null and x.status <> 'draft'
   for update;
  if not found then
    return null;
  end if;
  if c.status = 'settled' then
    raise exception 'Challan % is settled; trip updates and POD are closed', c.challan_no
      using errcode = 'check_violation';
  end if;
  return c;
end $$;
--> statement-breakpoint
revoke execute on function app.driver_link_challan(uuid, uuid, uuid) from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- driver-link API (service_role only) ----------
-- Opening the link: who it is for + the office to call. Stamps last_opened_at.
create or replace function app.driver_link_open(p_hash text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  info jsonb;
begin
  select * into k from app.driver_link_resolve(p_hash);
  if not found then
    return null;
  end if;
  update public.driver_links set last_opened_at = now() where id = k.link_id;
  select jsonb_build_object('driverName', d.name, 'companyName', c.name,
                            'officePhone', coalesce(c.mobile1, c.mobile2))
    into info
    from public.market_drivers d join public.companies c on c.id = d.company_id
   where d.company_id = k.company_id and d.id = k.driver_id;
  return info;
end $$;
--> statement-breakpoint

-- The driver's trips: live challans (dispatched … pod_received) plus those settled in the last 3 days
-- (read only). Trip facts only — no hire, rate, freight, charges, margin or balance; the only money is
-- the advance actually paid to the truck.
create or replace function app.driver_trips(p_hash text)
returns table (challan_id uuid, challan_no text, challan_date date, vehicle_no text, source text,
               destination text, status text, read_only boolean, advance_paid numeric,
               pod_status text, lrs jsonb, events jsonb)
language sql stable security definer set search_path = '' as $$
  select c.id, c.challan_no, (c.challan_at at time zone 'Asia/Kolkata')::date, v.vehicle_no,
         c.source, c.destination, c.status::text, c.status = 'settled',
         coalesce(adv.amount, 0)::numeric(14, 2),
         case when c.status = 'settled' then 'settled'
              when c.status = 'pod_received' then 'received'
              when ln.n > 0 and ln.with_files = ln.n then 'uploaded'
              when ln.with_files > 0 then 'partial'
              else 'pending' end,
         coalesce(ln.lrs, '[]'::jsonb),
         coalesce(ev.events, '[]'::jsonb)
    from app.driver_link_resolve(p_hash) k
    join public.challans c on c.company_id = k.company_id and c.driver_id = k.driver_id
    left join public.market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
    left join lateral (
      select sum(a.amount) as amount
        from public.truck_payment_allocations a
        join public.truck_payments p on p.company_id = a.company_id and p.id = a.payment_id
       where a.company_id = c.company_id and a.challan_id = c.id and a.kind = 'advance'
         and p.status = 'paid' and p.cancelled_at is null
    ) adv on true
    left join lateral (
      select count(*)::int as n,
             (count(*) filter (where cardinality(coalesce(pd.document_paths, '{}'::text[])) > 0))::int as with_files,
             jsonb_agg(jsonb_build_object(
               'lrId', l.id,
               'lrNo', l.lr_no,
               'lrDate', l.lr_date,
               'fromPlace', l.from_place,
               'toPlace', l.to_place,
               'consignor', jsonb_build_object('name', cr.name, 'address', cr.address, 'place', cr.place,
                                               'pincode', cr.pincode, 'phone', cr.phone),
               'consignee', jsonb_build_object('name', ce.name, 'address', ce.address, 'place', ce.place,
                                               'pincode', ce.pincode, 'phone', ce.phone),
               'goods', coalesce((
                  select jsonb_agg(jsonb_build_object('description', i.description, 'packages', i.packages,
                                                      'weight', i.actual_weight) order by i.position)
                    from public.lr_items i where i.company_id = l.company_id and i.lr_id = l.id), '[]'::jsonb),
               'packages', cl.loaded_pkgs,
               'weight', coalesce(cl.loaded_wt, (
                  select sum(i.actual_weight) from public.lr_items i
                   where i.company_id = l.company_id and i.lr_id = l.id)),
               'ewayBillNo', coalesce(cl.ewb_no, inv.eway_bill_no),
               'ewayExpiresAt', coalesce(cl.ewb_valid_upto, inv.eway_expires_at),
               'deliveredOn', (l.delivered_at at time zone 'utc')::date,
               'deliveredPkgs', cl.delivered_pkgs,
               'podFiles', cardinality(coalesce(pd.document_paths, '{}'::text[])),
               'podReceivedAt', pd.received_at
             ) order by cl.created_at, cl.id) as lrs
        from public.challan_lrs cl
        join public.lrs l on l.company_id = cl.company_id and l.id = cl.lr_id
        left join public.parties cr on cr.company_id = l.company_id and cr.id = l.consignor_id
        left join public.parties ce on ce.company_id = l.company_id and ce.id = l.consignee_id
        left join public.pods pd on pd.company_id = l.company_id and pd.lr_id = l.id and pd.cancelled_at is null
        left join lateral (
          select li.eway_bill_no, li.eway_expires_at
            from public.lr_invoices li
           where li.company_id = l.company_id and li.lr_id = l.id and li.eway_bill_no is not null
           order by li.eway_expires_at nulls last, li.position
           limit 1
        ) inv on true
       where cl.company_id = c.company_id and cl.challan_id = c.id
         and cl.transferred_to_challan_id is null and l.cancelled_at is null
    ) ln on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('type', e.type, 'at', e.at, 'source', e.source)
                       order by e.at, e.type) as events
        from public.trip_events e
       where e.company_id = c.company_id and e.challan_id = c.id
    ) ev on true
   where c.cancelled_at is null
     and (c.status in ('dispatched', 'in_transit', 'reached', 'pod_received')
          or (c.status = 'settled' and c.settled_at >= now() - interval '3 days'))
   order by c.challan_at desc, c.id;
$$;
--> statement-breakpoint

-- Loaded / en route / reached from the driver's phone, with its location when it has one (no location =
-- still saved, location null). One row per type per challan (from the link): repeating it updates the
-- time and location.
create or replace function app.driver_trip_event(p_hash text, p_challan uuid, p_type text,
                                                 p_lat numeric, p_lng numeric, p_accuracy numeric)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  c public.challans%rowtype;
  prev public.trip_events%rowtype;
  saved public.trip_events%rowtype;
  view_old jsonb;
  view_new jsonb;
  v_lat numeric := case when p_lat is null or p_lng is null then null else p_lat end;
  v_lng numeric := case when p_lat is null or p_lng is null then null else p_lng end;
  v_acc numeric := case when p_lat is null or p_lng is null then null else p_accuracy end;
begin
  select * into k from app.driver_link_resolve(p_hash);
  if not found then
    return null;
  end if;
  c := app.driver_link_challan(k.company_id, k.driver_id, p_challan);
  if c.id is null then
    return null;
  end if;
  select * into prev from public.trip_events e
   where e.company_id = k.company_id and e.challan_id = p_challan
     and e.type = p_type::public.trip_event_type and e.source = 'driver_link'
   for update;

  insert into public.trip_events as e (company_id, challan_id, type, at, lat, lng, accuracy_m, source,
                                       driver_link_id)
  values (k.company_id, p_challan, p_type::public.trip_event_type, now(), v_lat, v_lng, v_acc,
          'driver_link', k.link_id)
  on conflict (company_id, challan_id, type, source) do update
     set at = excluded.at,
         lat = coalesce(excluded.lat, e.lat), lng = coalesce(excluded.lng, e.lng),
         accuracy_m = case when excluded.lat is null then e.accuracy_m else excluded.accuracy_m end,
         driver_link_id = excluded.driver_link_id
  returning e.* into saved;

  view_new := jsonb_build_object('challanId', saved.challan_id, 'type', saved.type, 'source', saved.source,
                                 'at', saved.at, 'lat', saved.lat, 'lng', saved.lng,
                                 'accuracyM', saved.accuracy_m, 'driverLinkId', saved.driver_link_id);
  view_old := case when prev.id is null then null else
              jsonb_build_object('challanId', prev.challan_id, 'type', prev.type, 'source', prev.source,
                                 'at', prev.at, 'lat', prev.lat, 'lng', prev.lng,
                                 'accuracyM', prev.accuracy_m, 'driverLinkId', prev.driver_link_id) end;
  perform app.driver_link_audit(k.company_id, k.link_id, 'trip_events', saved.id,
                                case when prev.id is null then 'create' else 'update' end,
                                app.json_changes(view_old, view_new));
  return view_new || jsonb_build_object('id', saved.id, 'note', saved.note, 'createdBy', saved.created_by);
end $$;
--> statement-breakpoint

-- Before the server stores a POD file: the company folder for it, only for the driver's own live
-- (not settled) challan carrying this LR. Null = refuse.
create or replace function app.driver_pod_target(p_hash text, p_challan uuid, p_lr uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  c public.challans%rowtype;
begin
  select * into k from app.driver_link_resolve(p_hash);
  if not found then
    return null;
  end if;
  c := app.driver_link_challan(k.company_id, k.driver_id, p_challan);
  if c.id is null or not exists (
       select 1 from public.challan_lrs cl
         join public.lrs l on l.company_id = cl.company_id and l.id = cl.lr_id
        where cl.company_id = k.company_id and cl.challan_id = p_challan and cl.lr_id = p_lr
          and cl.transferred_to_challan_id is null and l.cancelled_at is null) then
    return null;
  end if;
  return k.company_id;
end $$;
--> statement-breakpoint

-- The driver's POD for one LR of their own non-settled challan: delivered date, packages delivered on
-- THIS challan, and the stored file paths (pod/{company}/{lr}/{id}-{name}). Writes the LR POD (its
-- single home) + the LR's delivery date, then the challan through app.sync_challan_pod_core — the same
-- dates / status / delivered-packages rules as a driver's POD in the app. The late-POD fee and shortage
-- are recomputed when the office settles (lib/data/db/challan-pod.ts settleChallan).
create or replace function app.driver_pod_attach(p_hash text, p_challan uuid, p_lr uuid, p_delivered_on date,
                                                 p_packages integer, p_paths text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  c public.challans%rowtype;
  line public.challan_lrs%rowtype;
  l record;
  p public.pods%rowtype;
  prev public.pods%rowtype;
  paths text[] := coalesce(p_paths, '{}'::text[]);
  file_re text;
  d_on date;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  other_pkgs integer;
  received integer;
  is_short boolean;
  synced record;
  pod_view_old jsonb;
  pod_view_new jsonb;
begin
  select * into k from app.driver_link_resolve(p_hash);
  if not found then
    return null;
  end if;
  c := app.driver_link_challan(k.company_id, k.driver_id, p_challan);
  if c.id is null then
    return null;
  end if;
  select * into line from public.challan_lrs x
   where x.company_id = k.company_id and x.challan_id = p_challan and x.lr_id = p_lr
     and x.transferred_to_challan_id is null;
  if not found then
    return null;
  end if;
  select x.lr_no, x.lr_date, x.booked_at, x.cancelled_at, x.delivered_at, x.dispatched_at into l
    from public.lrs x where x.company_id = k.company_id and x.id = p_lr for update;
  if l.cancelled_at is not null then
    return null;
  end if;
  if l.booked_at is null then
    raise exception 'LR % isn''t booked yet — call the office', l.lr_no using errcode = 'check_violation';
  end if;

  -- Only files this server stored for this company + LR.
  file_re := '^' || k.company_id::text || '/' || p_lr::text
             || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,80}$';
  if cardinality(paths) > 10 or exists (select 1 from unnest(paths) f where f !~ file_re) then
    raise exception 'Upload the file again' using errcode = 'check_violation';
  end if;

  d_on := coalesce(p_delivered_on, (l.delivered_at at time zone 'utc')::date, today);
  if d_on > today then
    raise exception 'Delivery date can''t be in the future' using errcode = 'check_violation';
  end if;
  if l.lr_date is not null and d_on < l.lr_date then
    raise exception 'Delivery date can''t be before the LR date (%)', to_char(l.lr_date, 'DD-MM-YYYY')
      using errcode = 'check_violation';
  end if;

  if p_packages is not null then
    if p_packages < 0 or p_packages > line.loaded_pkgs then
      raise exception 'Challan % loaded % packages of this LR', c.challan_no, line.loaded_pkgs
        using errcode = 'check_violation';
    end if;
    select coalesce(sum(o.delivered_pkgs), 0)::integer into other_pkgs
      from public.challan_lrs o
      join public.challans oc on oc.company_id = o.company_id and oc.id = o.challan_id
     where o.company_id = k.company_id and o.lr_id = p_lr and o.challan_id <> p_challan
       and oc.cancelled_at is null and o.transferred_to_challan_id is null;
    received := p_packages + other_pkgs;
  end if;
  is_short := p_packages is not null and p_packages < line.loaded_pkgs;

  -- The LR's delivery date (its single home), as the POD screen stores it (UTC midnight).
  if l.delivered_at is null or (l.delivered_at at time zone 'utc')::date <> d_on then
    perform app.set_lr_delivered(k.company_id, p_lr, d_on::timestamp at time zone 'utc');
    perform app.driver_link_audit(k.company_id, k.link_id, 'lrs', p_lr, 'update',
      app.json_changes(
        jsonb_build_object('deliveredAt', l.delivered_at, 'dispatchedAt', l.dispatched_at),
        jsonb_build_object('deliveredAt', d_on::timestamp at time zone 'utc',
                           'dispatchedAt', coalesce(l.dispatched_at, d_on::timestamp at time zone 'utc'))));
  end if;

  select * into prev from public.pods x
   where x.company_id = k.company_id and x.lr_id = p_lr and x.cancelled_at is null for update;
  if prev.id is null then
    insert into public.pods (company_id, lr_id, packages_received, condition, remarks, document_paths,
                             received_at)
    values (k.company_id, p_lr, received, case when is_short then 'short' else 'good' end::public.pod_condition,
            case when is_short then format('%s of %s packages short (challan %s, driver link)',
                                        line.loaded_pkgs - p_packages, line.loaded_pkgs, c.challan_no) end,
            paths, case when cardinality(paths) > 0 then now() end)
    returning * into p;
  else
    update public.pods x
       set packages_received = coalesce(received, x.packages_received),
           condition = case when is_short and x.condition = 'good' then 'short'::public.pod_condition
                            else x.condition end,
           remarks = case when is_short and x.condition = 'good' and coalesce(trim(x.remarks), '') = ''
                          then format('%s of %s packages short (challan %s, driver link)',
                                      line.loaded_pkgs - p_packages, line.loaded_pkgs, c.challan_no)
                          else x.remarks end,
           document_paths = (select coalesce(array_agg(f order by o), '{}'::text[]) from (
                               select f, min(o) as o
                                 from unnest(x.document_paths || paths) with ordinality as u(f, o)
                                group by f) d),
           received_at = coalesce(x.received_at, case when cardinality(paths) > 0 then now() end)
     where x.company_id = k.company_id and x.id = prev.id
    returning * into p;
  end if;
  pod_view_new := jsonb_build_object('lrId', p.lr_id, 'packagesReceived', p.packages_received,
                                     'condition', p.condition, 'remarks', p.remarks,
                                     'documentPaths', to_jsonb(p.document_paths), 'receivedAt', p.received_at);
  pod_view_old := case when prev.id is null then null else
                  jsonb_build_object('lrId', prev.lr_id, 'packagesReceived', prev.packages_received,
                                     'condition', prev.condition, 'remarks', prev.remarks,
                                     'documentPaths', to_jsonb(prev.document_paths),
                                     'receivedAt', prev.received_at) end;
  perform app.driver_link_audit(k.company_id, k.link_id, 'pods', p.id,
                                case when prev.id is null then 'create' else 'update' end,
                                app.json_changes(pod_view_old, pod_view_new));

  -- The challan: unloading / POD-received dates, status, delivered packages (refuses a settled one).
  select * into synced from app.sync_challan_pod_core(k.company_id, p_lr, p_challan);
  if synced.changed then
    perform app.driver_link_audit(k.company_id, k.link_id, 'challans', p_challan, 'update',
      app.json_changes(
        jsonb_build_object('status', c.status, 'unloadedAt', c.unloaded_at, 'podReceivedAt', c.pod_received_at,
                           'delivered', jsonb_build_object(p_lr::text, line.delivered_pkgs)),
        jsonb_build_object('status', synced.status, 'unloadedAt', synced.unloaded_at,
                           'podReceivedAt', synced.pod_received_at,
                           'delivered', jsonb_build_object(p_lr::text, synced.delivered_pkgs))));
  end if;

  return jsonb_build_object('podId', p.id, 'lrId', p.lr_id, 'documentPaths', to_jsonb(p.document_paths),
                            'packagesReceived', p.packages_received, 'receivedAt', p.received_at,
                            'deliveredOn', d_on, 'challanStatus', coalesce(synced.status, c.status::text));
end $$;
--> statement-breakpoint
-- Last seen: the phone's background location ping. Valid link only; a ping less than 5 minutes after the
-- last saved one (or without a usable location) is ignored. No audit row (it would flood the log).
-- Returns true when saved.
create or replace function app.driver_ping(p_hash text, p_lat numeric, p_lng numeric, p_accuracy numeric)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  n integer;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy < 0 then
    return false;
  end if;
  select * into k from app.driver_link_resolve(p_hash);
  if not found then
    return false;
  end if;
  update public.driver_links l
     set last_lat = p_lat, last_lng = p_lng, last_accuracy_m = p_accuracy, last_located_at = now()
   where l.id = k.link_id
     and (l.last_located_at is null or l.last_located_at <= now() - interval '5 minutes');
  get diagnostics n = row_count;
  return n > 0;
end $$;
--> statement-breakpoint

-- The driver's settled / cancelled challans within the company's driver_history_days, newest first, 20 per
-- page (p_before = only challans dated before that day; a page always ends on a whole day so no challan
-- of the last day is skipped), plus this month's summary. Read-only trip facts: never hire, freight,
-- margin, balance or advance.
create or replace function app.driver_history(p_hash text, p_before date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  k record;
  hist_days integer;
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  trips jsonb;
  month_trips integer;
  pods_pending integer;
begin
  select * into k from app.driver_link_resolve(p_hash);
  if not found then
    return null;
  end if;
  select c.driver_history_days into hist_days from public.companies c where c.id = k.company_id;

  with base as (
    select c.id, c.challan_no, (c.challan_at at time zone 'Asia/Kolkata')::date as challan_date, c.challan_at,
           v.vehicle_no, c.source, c.destination,
           case when c.cancelled_at is not null then 'cancelled' else 'settled' end as status,
           (c.pod_received_at is not null) as pod_done
      from public.challans c
      left join public.market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
     where c.company_id = k.company_id and c.driver_id = k.driver_id and c.status <> 'draft'
       and ((c.cancelled_at is null and c.status = 'settled'
             and c.settled_at >= now() - make_interval(days => hist_days))
            or (c.cancelled_at is not null and c.cancelled_at >= now() - make_interval(days => hist_days)))
       and (p_before is null or (c.challan_at at time zone 'Asia/Kolkata')::date < p_before)
  ), ranked as (
    select b.*, row_number() over (order by b.challan_at desc, b.id) as rn from base b
  ), cut as (
    select min(r.challan_date) as d from ranked r where r.rn <= 20
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'challanNo', r.challan_no, 'challanDate', r.challan_date, 'vehicleNo', r.vehicle_no,
           'source', r.source, 'destination', r.destination, 'status', r.status, 'podDone', r.pod_done)
         order by r.challan_at desc, r.id), '[]'::jsonb)
    into trips
    from ranked r
   where r.rn <= 20 or r.challan_date = (select d from cut);

  select count(*)::int into month_trips
    from public.challans c
   where c.company_id = k.company_id and c.driver_id = k.driver_id
     and c.cancelled_at is null and c.status <> 'draft' and c.challan_at >= month_start;
  select count(*)::int into pods_pending
    from public.challans c
   where c.company_id = k.company_id and c.driver_id = k.driver_id
     and c.cancelled_at is null and c.status in ('dispatched', 'in_transit', 'reached')
     and c.pod_received_at is null;

  return jsonb_build_object('trips', trips, 'historyDays', hist_days,
                            'tripsThisMonth', month_trips, 'podsPending', pods_pending);
end $$;
--> statement-breakpoint

-- Owner side: is the driver's link live, when it was opened, where the phone was last seen. Never returns
-- the token. freight.view (the link table itself stays master.edit only).
create or replace function app.driver_link_status(p_company uuid, p_driver uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.driver_links%rowtype;
begin
  if not app.can(p_company, 'freight.view') then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into l from public.driver_links x
   where x.company_id = p_company and x.market_driver_id = p_driver
   order by x.created_at desc limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'status', case when l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
                   then 'active' else 'revoked' end,
    'lastOpenedAt', l.last_opened_at, 'lastLat', l.last_lat, 'lastLng', l.last_lng,
    'lastAccuracyM', l.last_accuracy_m, 'lastLocatedAt', l.last_located_at);
end $$;
--> statement-breakpoint
revoke execute on function app.driver_link_status(uuid, uuid) from public, anon;
--> statement-breakpoint
grant execute on function app.driver_link_status(uuid, uuid) to authenticated;
--> statement-breakpoint

revoke execute on function app.driver_link_open(text), app.driver_trips(text),
  app.driver_trip_event(text, uuid, text, numeric, numeric, numeric),
  app.driver_pod_target(text, uuid, uuid),
  app.driver_pod_attach(text, uuid, uuid, date, integer, text[]),
  app.driver_ping(text, numeric, numeric, numeric),
  app.driver_history(text, date)
  from public, anon, authenticated;
--> statement-breakpoint
grant execute on function app.driver_link_open(text), app.driver_trips(text),
  app.driver_trip_event(text, uuid, text, numeric, numeric, numeric),
  app.driver_pod_target(text, uuid, uuid),
  app.driver_pod_attach(text, uuid, uuid, date, integer, text[]),
  app.driver_ping(text, numeric, numeric, numeric),
  app.driver_history(text, date)
  to service_role;
--> statement-breakpoint

-- ---------- company wipe (test / reset helper) must clear the new tables first ----------
do $$
declare
  def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'purge_company' and n.nspname = 'app' limit 1;
  if def is not null and def not like '%trip_events%' then
    execute replace(def,
      'delete from public.share_links where company_id = company;',
      'delete from public.trip_events where company_id = company;' || E'\n  ' ||
      'delete from public.driver_links where company_id = company;' || E'\n  ' ||
      'delete from public.share_links where company_id = company;');
  end if;
end $$;
