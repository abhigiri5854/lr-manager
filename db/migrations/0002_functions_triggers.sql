-- Hand-written (docs/DATABASE.md §1, §3, §5, §6). Helper functions in schema "app" and every
-- trigger drizzle-kit can't express. All definer functions pin search_path = ''.

-- ---------- purge switch (dev reset / integration-test cleanup only) ----------
-- Deletes are blocked everywhere. Only a non-API role (postgres, never authenticated/anon/
-- service_role) that sets app.purge = 'on' in its own transaction may delete.
create or replace function app.purging() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.purge', true), '') = 'on'
     and current_user not in ('authenticated', 'anon', 'service_role');
$$;
--> statement-breakpoint

-- No signed-in user and not an API JWT: migrations, seed, the secret-key server code.
-- Definer functions use this (inside them current_user is the owner, not the caller).
create or replace function app.is_system() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated');
$$;
--> statement-breakpoint

-- ---------- RLS helpers (§6) ----------
create or replace function app.role_in(company uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role
    from public.memberships m
    join public.companies c on c.id = m.company_id
   where m.company_id = company
     and m.user_id = auth.uid()
     and m.cancelled_at is null
     and c.cancelled_at is null
   limit 1;
$$;
--> statement-breakpoint
create or replace function app.is_member(company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.role_in(company) is not null;
$$;
--> statement-breakpoint
create or replace function app.can(company uuid, action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_permissions rp
     where rp.role = app.role_in(company) and rp.action = can.action
  );
$$;
--> statement-breakpoint
create or replace function app.is_office(company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.role_in(company) <> 'driver', false);
$$;
--> statement-breakpoint
create or replace function app.my_driver_id(company uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select d.id from public.drivers d
   where d.company_id = company and d.user_id = auth.uid() and d.cancelled_at is null
   limit 1;
$$;
--> statement-breakpoint
-- Same rule as assertPodAccess in lib/data/pod.ts: the LR's driver mobile is mine, or its truck
-- has me as driver.
create or replace function app.is_own_trip(company uuid, lr uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.lrs l
      join public.drivers d on d.id = app.my_driver_id(company)
      left join public.trucks t on t.company_id = l.company_id and t.id = l.truck_id
     where l.company_id = company and l.id = lr
       and (l.driver_mobile = d.mobile or t.driver_id = d.id)
  );
$$;
--> statement-breakpoint
-- Two users share an active company (users table SELECT).
create or replace function app.shares_company(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.memberships a
      join public.memberships b on b.company_id = a.company_id
     where a.user_id = auth.uid() and b.user_id = other
       and a.cancelled_at is null and b.cancelled_at is null
  );
$$;
--> statement-breakpoint
-- First folder of a Storage object path ({company_id}/{record_id}/…), or null if not a uuid.
create or replace function app.path_part(path text, n int) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(path, '/', n) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(path, '/', n)::uuid end;
$$;
--> statement-breakpoint

-- ---------- financial year ----------
create or replace function app.financial_year(d date) returns text
language sql immutable set search_path = '' as $$
  select case when extract(month from d) >= 4
              then extract(year from d)::int
              else extract(year from d)::int - 1 end
         || '-' || lpad((((case when extract(month from d) >= 4
                                then extract(year from d)::int
                                else extract(year from d)::int - 1 end) + 1) % 100)::text, 2, '0');
$$;
--> statement-breakpoint

-- ---------- generic row triggers (§1) ----------
-- Insert: who created it.
create or replace function app.tg_stamp_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.updated_by := coalesce(new.updated_by, new.created_by);
  return new;
end $$;
--> statement-breakpoint
-- Update: bump version / updated_at / updated_by. Columns named in TG_ARGV are caches (stamps,
-- search text): a change to only those is not an edit and doesn't bump the version.
create or replace function app.tg_bump_row() returns trigger
language plpgsql set search_path = '' as $$
declare
  ignored text[] := array['updated_at', 'updated_by', 'version'] || coalesce(tg_argv::text[], '{}');
begin
  if (to_jsonb(new) - ignored) = (to_jsonb(old) - ignored) then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
    new.version := old.version;
    return new;
  end if;
  new.updated_at := now();
  new.version := old.version + 1;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
--> statement-breakpoint
-- Cancel guard: setting cancelled_at needs the permission in TG_ARGV[0] (default record.cancel).
-- A cancelled row can't be changed (except caches listed after it) or un-cancelled.
create or replace function app.tg_cancel_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  action text := coalesce(tg_argv[0], 'record.cancel');
  ignored text[] := array['updated_at', 'updated_by', 'version'] || coalesce(tg_argv[1:]::text[], '{}');
  company uuid := case when tg_table_name = 'companies' then new.id
                       else (to_jsonb(new) ->> 'company_id')::uuid end;
begin
  if old.cancelled_at is not null then
    if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored) then
      raise exception 'This record is cancelled and can''t be changed'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.cancelled_at is not null and not app.is_system() and not app.can(company, action) then
    raise exception 'Your role can''t cancel this record (needs %)', action
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
--> statement-breakpoint
-- No hard deletes on business tables and the audit log.
create or replace function app.tg_no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if app.purging() then return old; end if;
  raise exception '% rows are never deleted — cancel instead', tg_table_name
    using errcode = 'insufficient_privilege';
end $$;
--> statement-breakpoint
-- audit_log is append-only.
create or replace function app.tg_audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and app.purging() then return old; end if;
  raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege';
end $$;
--> statement-breakpoint
-- Snapshots are written once. LRs may refresh a party's snapshot only when that party is swapped
-- for another (lib/data/lrs.ts updateLr); the company part never changes.
create or replace function app.tg_snapshot_freeze() returns trigger
language plpgsql set search_path = '' as $$
declare
  k text;
begin
  if old.snapshot is null or new.snapshot is not distinct from old.snapshot then return new; end if;
  if tg_table_name = 'lrs' and new.snapshot is not null
     and new.snapshot -> 'company' = old.snapshot -> 'company' then
    foreach k in array array['consignor', 'consignee', 'billedTo'] loop
      if (new.snapshot -> k) is distinct from (old.snapshot -> k)
         and (new.snapshot -> k ->> 'id') is not distinct from (old.snapshot -> k ->> 'id') then
        raise exception 'The % snapshot of a booked LR can''t change', k
          using errcode = 'check_violation';
      end if;
    end loop;
    return new;
  end if;
  raise exception 'The snapshot of a finalised % can''t change', tg_table_name
    using errcode = 'check_violation';
end $$;
--> statement-breakpoint

-- Attach the generic triggers. Names start with a letter so the order is explicit:
-- a_stamp (insert), b_cancel_guard, c_bump (update), z_no_delete.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('companies',       'company.manage', array[]::text[]),
      ('memberships',     'company.manage', array[]::text[]),
      ('parties',         'record.cancel',  array['search_text']),
      ('drivers',         'record.cancel',  array['search_text']),
      ('trucks',          'record.cancel',  array[]::text[]),
      ('items',           'record.cancel',  array['search_text']),
      ('lrs',             'record.cancel',  array['pod_received_at', 'billed_at', 'paid_at', 'search_text']),
      ('tax_invoices',    'record.cancel',  array['search_text']),
      ('pods',            'record.cancel',  array[]::text[]),
      ('freight_bills',   'record.cancel',  array['search_text']),
      ('payments',        'record.cancel',  array[]::text[]),
      ('import_batches',  'import.run',     array[]::text[]),
      ('import_mappings', 'import.run',     array[]::text[])
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
create trigger z_no_delete before delete on public.users
  for each row execute function app.tg_no_delete();
--> statement-breakpoint
create trigger z_no_delete before delete on public.number_series
  for each row execute function app.tg_no_delete();
--> statement-breakpoint
create trigger a_append_only before update or delete on public.audit_log
  for each row execute function app.tg_audit_append_only();
--> statement-breakpoint
create trigger d_snapshot_freeze before update of snapshot on public.lrs
  for each row execute function app.tg_snapshot_freeze();
--> statement-breakpoint
create trigger d_snapshot_freeze before update of snapshot on public.tax_invoices
  for each row execute function app.tg_snapshot_freeze();
--> statement-breakpoint
create trigger d_snapshot_freeze before update of snapshot on public.freight_bills
  for each row execute function app.tg_snapshot_freeze();
--> statement-breakpoint

-- ---------- users ← Supabase Auth ----------
create or replace function app.tg_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, name, email, mobile)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    nullif(new.raw_user_meta_data ->> 'mobile', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
--> statement-breakpoint
create or replace function app.tg_auth_user_updated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.users set email = new.email, updated_at = now()
   where id = new.id and email is distinct from new.email;
  return new;
end $$;
--> statement-breakpoint
drop trigger if exists lr_manager_user_created on auth.users;
--> statement-breakpoint
create trigger lr_manager_user_created after insert on auth.users
  for each row execute function app.tg_auth_user_created();
--> statement-breakpoint
drop trigger if exists lr_manager_user_updated on auth.users;
--> statement-breakpoint
create trigger lr_manager_user_updated after update of email on auth.users
  for each row execute function app.tg_auth_user_updated();
--> statement-breakpoint
create or replace function app.tg_users_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
--> statement-breakpoint
create trigger c_touch before update on public.users
  for each row execute function app.tg_users_touch();
--> statement-breakpoint

-- ---------- memberships: a company always keeps an active owner ----------
create or replace function app.tg_keep_one_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'owner' and old.cancelled_at is null
     and (new.role <> 'owner' or new.cancelled_at is not null)
     and not exists (
       select 1 from public.memberships m
        where m.company_id = old.company_id and m.id <> old.id
          and m.role = 'owner' and m.cancelled_at is null)
  then
    raise exception 'A company needs at least one owner' using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger e_keep_one_owner after update on public.memberships
  for each row execute function app.tg_keep_one_owner();
--> statement-breakpoint

-- ---------- self party (lib/self-party.ts) ----------
-- Last 6-digit PIN code in the office address ("… Patna - 800026" → "800026").
create or replace function app.self_party_pincode(office text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  m text[];
  pin text;
begin
  for m in select regexp_matches(coalesce(office, ''), '(^|[^0-9])([1-9][0-9]{5})(?=[^0-9]|$)', 'g') loop
    pin := m[2];
  end loop;
  return pin;
end $$;
--> statement-breakpoint
create or replace function app.tg_company_self_party() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.parties (company_id, name, place, gstin, pan, phone, address, state_code,
                                pincode, source, is_self, created_at, updated_at)
    values (new.id, new.name, nullif(new.city, ''), new.gstin, new.pan, new.mobile1,
            nullif(new.office, ''), left(new.gstin, 2), app.self_party_pincode(new.office),
            'manual', true, new.created_at, new.created_at);
  else
    update public.parties p
       set name = new.name, place = nullif(new.city, ''), gstin = new.gstin, pan = new.pan,
           phone = new.mobile1, address = nullif(new.office, ''), state_code = left(new.gstin, 2),
           pincode = app.self_party_pincode(new.office)
     where p.company_id = new.id and p.is_self
       and (p.name, p.place, p.gstin, p.pan, p.phone, p.address, p.state_code, p.pincode)
           is distinct from
           (new.name, nullif(new.city, ''), new.gstin, new.pan, new.mobile1,
            nullif(new.office, ''), left(new.gstin, 2)::char(2), app.self_party_pincode(new.office));
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger f_self_party after insert or update on public.companies
  for each row execute function app.tg_company_self_party();
--> statement-breakpoint
-- The self party is never cancelled, and its mirrored fields change only through the company.
create or replace function app.tg_self_party_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.is_self and pg_trigger_depth() < 2 and not app.is_system() then
      raise exception 'The self party is created with the company' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.is_self is distinct from old.is_self then
    raise exception 'is_self can''t change' using errcode = 'check_violation';
  end if;
  if old.is_self then
    if new.cancelled_at is not null then
      raise exception 'This is your own company. It can''t be cancelled from Parties.'
        using errcode = 'check_violation';
    end if;
    if pg_trigger_depth() < 2
       and (new.name, new.place, new.gstin, new.pan, new.phone, new.address, new.state_code, new.pincode)
           is distinct from
           (old.name, old.place, old.gstin, old.pan, old.phone, old.address, old.state_code, old.pincode)
    then
      raise exception 'This is your own company. Its details come from Company profile.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b_self_party_guard before insert or update on public.parties
  for each row execute function app.tg_self_party_guard();
--> statement-breakpoint

-- ---------- number series (§3.3) ----------
create or replace function app.series_permission(series public.number_series_kind) returns text
language sql immutable set search_path = '' as $$
  select case series when 'lr' then 'lr.edit' when 'freight_bill' then 'bill.edit'
                     else 'invoice.edit' end;
$$;
--> statement-breakpoint
-- Ensures the FY row exists (locked) and returns it. Start: 1 for a series that restarts each FY,
-- else carry on from the latest FY; an LR series that was never set up is an error.
create or replace function app.lock_series(company uuid, kind public.number_series_kind, fy text)
returns public.number_series
language plpgsql security definer set search_path = '' as $$
declare
  r public.number_series;
  c public.companies;
  start_no bigint;
begin
  select * into r from public.number_series s
   where s.company_id = company and s.series = kind and s.fy = lock_series.fy for update;
  if found then return r; end if;

  select * into c from public.companies where id = company;
  if not found then raise exception 'Company not found' using errcode = 'no_data_found'; end if;
  if kind <> 'lr' and c.numbering_resets_yearly then
    start_no := 1;
  else
    select s.next_no into start_no from public.number_series s
     where s.company_id = company and s.series = kind order by s.fy desc limit 1;
    if start_no is null then
      if kind = 'lr' then
        raise exception 'Set the next LR number in Company profile first' using errcode = 'check_violation';
      end if;
      start_no := 1;
    end if;
  end if;
  insert into public.number_series (company_id, series, fy, prefix, next_no)
  values (company, kind, lock_series.fy,
          case kind when 'lr' then c.lr_prefix when 'freight_bill' then c.freight_bill_prefix
                    else c.tax_invoice_prefix end,
          start_no)
  on conflict do nothing;
  select * into r from public.number_series s
   where s.company_id = company and s.series = kind and s.fy = lock_series.fy for update;
  return r;
end $$;
--> statement-breakpoint
-- Takes the next number inside the caller's transaction (row lock, never max + 1). A rollback
-- gives the number back, so the series has no gaps.
create or replace function app.allocate_number(company uuid, kind public.number_series_kind, fy text)
returns table (prefix text, no bigint)
language plpgsql security definer set search_path = '' as $$
declare
  r public.number_series;
begin
  if not app.is_system() and not app.can(company, app.series_permission(kind)) then
    raise exception 'Your role can''t take % numbers', kind using errcode = 'insufficient_privilege';
  end if;
  r := app.lock_series(company, kind, allocate_number.fy);
  update public.number_series s set next_no = s.next_no + 1, updated_at = now()
   where s.company_id = company and s.series = kind and s.fy = allocate_number.fy;
  return query select r.prefix, r.next_no;
end $$;
--> statement-breakpoint
-- Next number without taking it (null: LR series never set up).
create or replace function app.peek_number(company uuid, kind public.number_series_kind, fy text)
returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.next_no from public.number_series s
      where s.company_id = company and s.series = kind and s.fy = peek_number.fy),
    case when kind <> 'lr' and (select numbering_resets_yearly from public.companies where id = company)
         then 1 end,
    (select s.next_no from public.number_series s
      where s.company_id = company and s.series = kind order by s.fy desc limit 1),
    case when kind <> 'lr' then 1 end
  ) where app.is_office(company) or app.is_system();
$$;
--> statement-breakpoint
-- Company profile / Smart import: move a series forward, never backwards.
create or replace function app.raise_number(company uuid, kind public.number_series_kind, fy text, wanted bigint)
returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  cur bigint;
begin
  if not app.is_system() and not app.can(company, 'company.manage')
     and not app.can(company, app.series_permission(kind)) then
    raise exception 'Your role can''t change numbering' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.number_series s
   where s.company_id = company and s.series = kind and s.fy = raise_number.fy for update;
  cur := app.peek_number(company, kind, raise_number.fy);
  if cur is not null and wanted < cur then
    raise exception 'Can''t go below % — numbers up to % may already be used', cur, cur - 1
      using errcode = 'check_violation';
  end if;
  insert into public.number_series (company_id, series, fy, prefix, next_no)
  select company, kind, raise_number.fy,
         case kind when 'lr' then c.lr_prefix when 'freight_bill' then c.freight_bill_prefix
                   else c.tax_invoice_prefix end,
         wanted
    from public.companies c where c.id = company
  on conflict (company_id, series, fy) do update
    set next_no = greatest(public.number_series.next_no, excluded.next_no), updated_at = now();
end $$;
--> statement-breakpoint

-- ---------- create company (company + owner + self party + series, one transaction) ----------
create or replace function app.create_company(p_label text, p_name text, p_city text, p_gstin text, p_pan text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  company uuid;
  fy text := app.financial_year((now() at time zone 'Asia/Kolkata')::date);
begin
  if me is null then raise exception 'Sign in first' using errcode = 'insufficient_privilege'; end if;
  insert into public.companies (label, name, city, gstin, pan, created_by, updated_by,
                                lr_copies)
  values (p_label, p_name, coalesce(p_city, ''), p_gstin, p_pan, me, me,
          array['Consignor', 'Consignee', 'Driver', 'Office'])
  returning id into company;
  insert into public.memberships (company_id, user_id, role, created_by, updated_by)
  values (company, me, 'owner', me, me);
  insert into public.number_series (company_id, series, fy, prefix, next_no)
  values (company, 'lr', fy, '', 1), (company, 'freight_bill', fy, '', 1),
         (company, 'tax_invoice', fy, '', 1);
  return company;
end $$;
--> statement-breakpoint

-- ---------- LR delivery (POD screen) and driver trips ----------
-- Records / clears the LR's delivery date. Office roles with pod.upload on any LR; drivers on
-- their own trips (they can't update lrs directly — no freight.view).
create or replace function app.set_lr_delivered(company uuid, lr uuid, delivered timestamptz)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_system() and not (
       app.can(company, 'lr.edit') or app.can(company, 'pod.upload')
       or (app.can(company, 'pod.upload_own') and app.is_own_trip(company, lr))) then
    raise exception 'You can only record POD for your own trips' using errcode = 'insufficient_privilege';
  end if;
  update public.lrs l
     set delivered_at = delivered, dispatched_at = coalesce(l.dispatched_at, delivered)
   where l.company_id = company and l.id = lr and l.cancelled_at is null;
end $$;
--> statement-breakpoint
-- The driver app's trip list: no money columns.
create or replace function app.my_trips(company uuid)
returns table (
  id uuid, lr_no text, lr_date date, from_place text, to_place text, consignee_name text,
  truck_number text, booked_at timestamptz, dispatched_at timestamptz, delivered_at timestamptz,
  pod_received_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select l.id, l.lr_no, l.lr_date, l.from_place, l.to_place, p.name, t.number,
         l.booked_at, l.dispatched_at, l.delivered_at, l.pod_received_at
    from public.lrs l
    left join public.parties p on p.company_id = l.company_id and p.id = l.consignee_id
    left join public.trucks t on t.company_id = l.company_id and t.id = l.truck_id
   where l.company_id = company and l.cancelled_at is null and l.booked_at is not null
     and app.is_own_trip(company, l.id)
   order by l.lr_date desc, l.created_at desc;
$$;
--> statement-breakpoint

-- ---------- cached LR stamps (§5): pod_received_at, billed_at, paid_at ----------
-- Same rule as lrStampsFrom in lib/lr-status.ts. Definer, so an accountant recording a payment
-- updates the LR without lr.edit.
create or replace function app.refresh_lr_stamps(company uuid, lr uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pod_at timestamptz;
  bill public.freight_bills;
  received bigint;
  last_on date;
begin
  select p.received_at into pod_at from public.pods p
   where p.company_id = company and p.lr_id = lr and p.cancelled_at is null
   limit 1;
  select b.* into bill
    from public.freight_bill_lines fl
    join public.freight_bills b on b.company_id = fl.company_id and b.id = fl.freight_bill_id
   where fl.company_id = company and fl.lr_id = lr and fl.bill_cancelled_at is null
     and b.cancelled_at is null and b.status = 'final'
   limit 1;
  if bill.id is not null then
    select coalesce(sum(a.amount_paise), 0), max(p.received_on) into received, last_on
      from public.payment_allocations a
      join public.payments p on p.company_id = a.company_id and p.id = a.payment_id
     where a.company_id = company and a.freight_bill_id = bill.id and p.cancelled_at is null;
  end if;
  update public.lrs l
     set pod_received_at = pod_at,
         billed_at = bill.bill_date,
         paid_at = case when bill.id is not null and received >= bill.amount_paise then last_on end
   where l.company_id = company and l.id = lr
     and (l.pod_received_at, l.billed_at, l.paid_at) is distinct from
         (pod_at, bill.bill_date,
          case when bill.id is not null and received >= bill.amount_paise then last_on end);
end $$;
--> statement-breakpoint
create or replace function app.refresh_bill_lrs(company uuid, bill uuid) returns void
language sql security definer set search_path = '' as $$
  select app.refresh_lr_stamps(company, fl.lr_id)
    from public.freight_bill_lines fl
   where fl.company_id = company and fl.freight_bill_id = bill;
$$;
--> statement-breakpoint
create or replace function app.tg_pod_stamps() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.lr_id <> new.lr_id then
    perform app.refresh_lr_stamps(old.company_id, old.lr_id);
  end if;
  perform app.refresh_lr_stamps(new.company_id, new.lr_id);
  return null;
end $$;
--> statement-breakpoint
create trigger g_lr_stamps after insert or update on public.pods
  for each row execute function app.tg_pod_stamps();
--> statement-breakpoint
-- Bill: copy cancelled_at onto its lines (live-line unique index), then refresh its LRs.
create or replace function app.tg_bill_stamps() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cancelled_at is distinct from old.cancelled_at then
    update public.freight_bill_lines fl set bill_cancelled_at = new.cancelled_at
     where fl.company_id = new.company_id and fl.freight_bill_id = new.id;
  end if;
  if (new.status, new.cancelled_at, new.bill_date, new.amount_paise)
     is distinct from (old.status, old.cancelled_at, old.bill_date, old.amount_paise) then
    perform app.refresh_bill_lrs(new.company_id, new.id);
  end if;
  return null;
end $$;
--> statement-breakpoint
create trigger g_lr_stamps after update on public.freight_bills
  for each row execute function app.tg_bill_stamps();
--> statement-breakpoint
create or replace function app.tg_bill_line_copy_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select b.cancelled_at into new.bill_cancelled_at from public.freight_bills b
   where b.company_id = new.company_id and b.id = new.freight_bill_id;
  return new;
end $$;
--> statement-breakpoint
create trigger a_copy_cancel before insert on public.freight_bill_lines
  for each row execute function app.tg_bill_line_copy_cancel();
--> statement-breakpoint
create or replace function app.tg_bill_line_stamps() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.refresh_lr_stamps(old.company_id, old.lr_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.refresh_lr_stamps(new.company_id, new.lr_id);
  end if;
  return null;
end $$;
--> statement-breakpoint
create trigger g_lr_stamps after insert or update or delete on public.freight_bill_lines
  for each row execute function app.tg_bill_line_stamps();
--> statement-breakpoint
create or replace function app.tg_payment_stamps() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.cancelled_at, new.received_on) is distinct from (old.cancelled_at, old.received_on) then
    perform app.refresh_bill_lrs(a.company_id, a.freight_bill_id)
       from public.payment_allocations a
      where a.company_id = new.company_id and a.payment_id = new.id;
  end if;
  return null;
end $$;
--> statement-breakpoint
create trigger g_lr_stamps after update on public.payments
  for each row execute function app.tg_payment_stamps();
--> statement-breakpoint
create or replace function app.tg_allocation_stamps() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.refresh_bill_lrs(old.company_id, old.freight_bill_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.refresh_bill_lrs(new.company_id, new.freight_bill_id);
  end if;
  return null;
end $$;
--> statement-breakpoint
create trigger g_lr_stamps after insert or update or delete on public.payment_allocations
  for each row execute function app.tg_allocation_stamps();
--> statement-breakpoint
-- Allocation backstop for lib/data/bills.ts: final, live bill of the payment's party.
create or replace function app.tg_allocation_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  bill public.freight_bills;
  pay public.payments;
begin
  select * into bill from public.freight_bills b
   where b.company_id = new.company_id and b.id = new.freight_bill_id;
  select * into pay from public.payments p
   where p.company_id = new.company_id and p.id = new.payment_id;
  if bill.party_id is distinct from pay.party_id then
    raise exception 'Bill % is for another party', bill.bill_no using errcode = 'check_violation';
  end if;
  if bill.status <> 'final' or bill.cancelled_at is not null then
    raise exception 'Bill not found or not final' using errcode = 'check_violation';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger a_check before insert or update on public.payment_allocations
  for each row execute function app.tg_allocation_check();
--> statement-breakpoint
-- The stamps are caches: only these triggers write them (a direct edit is put back).
create or replace function app.tg_lr_stamps_readonly() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() < 2 and not app.is_system() then
    if tg_op = 'INSERT' then
      new.pod_received_at := null; new.billed_at := null; new.paid_at := null;
    else
      new.pod_received_at := old.pod_received_at;
      new.billed_at := old.billed_at;
      new.paid_at := old.paid_at;
    end if;
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger a_stamps_readonly before insert or update on public.lrs
  for each row execute function app.tg_lr_stamps_readonly();
--> statement-breakpoint

-- ---------- LR column guard (§6) ----------
-- Without lr.edit you may only record delivery (delivered_at / dispatched_at); a driver only on
-- their own trip. Caches written by triggers are always allowed.
create or replace function app.tg_lr_column_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  allowed text[] := array['delivered_at', 'dispatched_at', 'updated_at', 'updated_by', 'version',
                          'pod_received_at', 'billed_at', 'paid_at', 'search_text'];
begin
  if app.is_system() or app.can(new.company_id, 'lr.edit') then return new; end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Your role can''t edit LRs — only record delivery' using errcode = 'insufficient_privilege';
  end if;
  if (new.delivered_at, new.dispatched_at) is distinct from (old.delivered_at, old.dispatched_at)
     and not app.can(new.company_id, 'pod.upload')
     and not (app.can(new.company_id, 'pod.upload_own') and app.is_own_trip(new.company_id, new.id)) then
    raise exception 'You can only record POD for your own trips' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger b_lr_column_guard before update on public.lrs
  for each row execute function app.tg_lr_column_guard();
--> statement-breakpoint

-- ---------- search_text kept by trigger (§7) ----------
create or replace function app.lr_search_text(l public.lrs) returns text
language sql stable security definer set search_path = '' as $$
  select lower(concat_ws(' ',
    l.lr_no, l.from_place, l.to_place, l.driver_mobile,
    (select p.name from public.parties p where p.company_id = l.company_id and p.id = l.consignor_id),
    (select p.name from public.parties p where p.company_id = l.company_id and p.id = l.consignee_id),
    (select p.name from public.parties p where p.company_id = l.company_id and p.id = l.billed_to_id),
    (select t.number from public.trucks t where t.company_id = l.company_id and t.id = l.truck_id),
    (select string_agg(concat_ws(' ', i.invoice_no, i.eway_bill_no), ' ' order by i.position)
       from public.lr_invoices i where i.company_id = l.company_id and i.lr_id = l.id)));
$$;
--> statement-breakpoint
create or replace function app.tax_invoice_search_text(t public.tax_invoices) returns text
language sql stable security definer set search_path = '' as $$
  select lower(concat_ws(' ',
    t.invoice_no,
    (select concat_ws(' ', p.name, p.gstin) from public.parties p
      where p.company_id = t.company_id and p.id = t.bill_to_id),
    (select string_agg(l.lr_no, ' ') from public.lr_invoices i
       join public.lrs l on l.company_id = i.company_id and l.id = i.lr_id
      where i.company_id = t.company_id and i.tax_invoice_id = t.id)));
$$;
--> statement-breakpoint
create or replace function app.freight_bill_search_text(b public.freight_bills) returns text
language sql stable security definer set search_path = '' as $$
  select lower(concat_ws(' ',
    b.bill_no,
    (select p.name from public.parties p where p.company_id = b.company_id and p.id = b.party_id),
    (select string_agg(l.lr_no, ' ' order by fl.position) from public.freight_bill_lines fl
       join public.lrs l on l.company_id = fl.company_id and l.id = fl.lr_id
      where fl.company_id = b.company_id and fl.freight_bill_id = b.id)));
$$;
--> statement-breakpoint
create or replace function app.tg_lr_search_text() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search_text := app.lr_search_text(new);
  return new;
end $$;
--> statement-breakpoint
create or replace function app.tg_tax_invoice_search_text() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search_text := app.tax_invoice_search_text(new);
  return new;
end $$;
--> statement-breakpoint
create or replace function app.tg_freight_bill_search_text() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search_text := app.freight_bill_search_text(new);
  return new;
end $$;
--> statement-breakpoint
create trigger h_search_text before insert or update on public.lrs
  for each row execute function app.tg_lr_search_text();
--> statement-breakpoint
create trigger h_search_text before insert or update on public.tax_invoices
  for each row execute function app.tg_tax_invoice_search_text();
--> statement-breakpoint
create trigger h_search_text before insert or update on public.freight_bills
  for each row execute function app.tg_freight_bill_search_text();
--> statement-breakpoint
-- Children and renamed masters re-touch the parent so its BEFORE trigger recomputes the text.
create or replace function app.tg_lr_invoice_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  co uuid;
  lr uuid;
  invs uuid[];
begin
  if tg_op = 'DELETE' then
    co := old.company_id; lr := old.lr_id; invs := array[old.tax_invoice_id];
  elsif tg_op = 'UPDATE' then
    co := new.company_id; lr := new.lr_id; invs := array[old.tax_invoice_id, new.tax_invoice_id];
  else
    co := new.company_id; lr := new.lr_id; invs := array[new.tax_invoice_id];
  end if;
  update public.lrs set search_text = search_text where company_id = co and id = lr;
  update public.tax_invoices set search_text = search_text where company_id = co and id = any (invs);
  return null;
end $$;
--> statement-breakpoint
create or replace function app.tg_bill_line_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.freight_bills set search_text = search_text
     where company_id = old.company_id and id = old.freight_bill_id;
  else
    update public.freight_bills set search_text = search_text
     where company_id = new.company_id and id = new.freight_bill_id;
  end if;
  return null;
end $$;
--> statement-breakpoint
create or replace function app.tg_party_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.lrs set search_text = search_text
   where company_id = new.company_id and new.id in (consignor_id, consignee_id, billed_to_id);
  update public.tax_invoices set search_text = search_text
   where company_id = new.company_id and bill_to_id = new.id;
  update public.freight_bills set search_text = search_text
   where company_id = new.company_id and party_id = new.id;
  return null;
end $$;
--> statement-breakpoint
create or replace function app.tg_truck_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.lrs set search_text = search_text
   where company_id = new.company_id and truck_id = new.id;
  return null;
end $$;
--> statement-breakpoint
create trigger h_touch_search after insert or update or delete on public.lr_invoices
  for each row execute function app.tg_lr_invoice_touch();
--> statement-breakpoint
create trigger h_touch_search after insert or update or delete on public.freight_bill_lines
  for each row execute function app.tg_bill_line_touch();
--> statement-breakpoint
create trigger h_touch_search after update of name, gstin on public.parties
  for each row execute function app.tg_party_touch();
--> statement-breakpoint
create trigger h_touch_search after update of number on public.trucks
  for each row execute function app.tg_truck_touch();
--> statement-breakpoint

-- ---------- view: what has been received against each bill ----------
create view public.freight_bill_balances with (security_invoker = true) as
select b.id as freight_bill_id,
       b.company_id,
       coalesce(r.received, 0)::bigint as received_paise,
       case when b.status = 'final' and b.cancelled_at is null
            then b.amount_paise - coalesce(r.received, 0) else 0 end::bigint as due_paise,
       case when b.status = 'final' and b.cancelled_at is null
             and coalesce(r.received, 0) >= b.amount_paise then r.last_on end as paid_on
  from public.freight_bills b
  left join lateral (
    select sum(a.amount_paise) as received, max(p.received_on) as last_on
      from public.payment_allocations a
      join public.payments p on p.company_id = a.company_id and p.id = a.payment_id
     where a.company_id = b.company_id and a.freight_bill_id = b.id and p.cancelled_at is null
  ) r on true;
--> statement-breakpoint

-- ---------- trigram search indexes (§7) ----------
create index lrs_search_trgm_idx on public.lrs using gin (search_text extensions.gin_trgm_ops);
--> statement-breakpoint
create index tax_invoices_search_trgm_idx on public.tax_invoices using gin (search_text extensions.gin_trgm_ops);
--> statement-breakpoint
create index freight_bills_search_trgm_idx on public.freight_bills using gin (search_text extensions.gin_trgm_ops);
--> statement-breakpoint
create index parties_search_trgm_idx on public.parties using gin (search_text extensions.gin_trgm_ops);
--> statement-breakpoint
create index drivers_search_trgm_idx on public.drivers using gin (search_text extensions.gin_trgm_ops);
--> statement-breakpoint
create index items_search_trgm_idx on public.items using gin (search_text extensions.gin_trgm_ops);
--> statement-breakpoint
create index trucks_number_trgm_idx on public.trucks using gin (number extensions.gin_trgm_ops);
--> statement-breakpoint

-- ---------- dev / test cleanup: remove one company and everything in it ----------
-- Never granted to API roles; needs app.purging() (postgres + app.purge = 'on').
create or replace function app.purge_company(company uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if not app.purging() then
    raise exception 'purge_company needs app.purge = on (dev / tests only)' using errcode = 'insufficient_privilege';
  end if;
  delete from public.audit_log where company_id = company;
  delete from public.payment_allocations where company_id = company;
  delete from public.payments where company_id = company;
  delete from public.freight_bill_lines where company_id = company;
  delete from public.freight_bills where company_id = company;
  delete from public.pods where company_id = company;
  delete from public.lr_invoices where company_id = company;
  delete from public.lr_items where company_id = company;
  delete from public.lrs where company_id = company;
  delete from public.tax_invoice_lines where company_id = company;
  delete from public.tax_invoices where company_id = company;
  delete from public.import_mappings where company_id = company;
  delete from public.import_batches where company_id = company;
  delete from public.trucks where company_id = company;
  delete from public.drivers where company_id = company;
  delete from public.items where company_id = company;
  delete from public.parties where company_id = company;
  delete from public.memberships where company_id = company;
  delete from public.number_series where company_id = company;
  delete from public.companies where id = company;
end $$;
--> statement-breakpoint

-- ---------- privileges ----------
-- Schema app is reachable only by signed-in users (RLS helpers) and the secret key.
revoke all on schema app from public;
--> statement-breakpoint
grant usage on schema app to authenticated, service_role;
--> statement-breakpoint
revoke execute on all functions in schema app from public;
--> statement-breakpoint
grant execute on all functions in schema app to authenticated, service_role;
--> statement-breakpoint
revoke execute on function app.purge_company(uuid) from authenticated, service_role;
