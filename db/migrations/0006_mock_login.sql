-- Hand-written. Helpers the app needs while it still uses the mock login on the database
-- (prompt 19a). Each one answers a question RLS can't (the caller can't see those rows) and
-- returns as little as possible. login_lookup goes away with Supabase Auth logins (prompt 20).

-- Login: the account for a 10-digit mobile number or an e-mail. Runs before anyone is signed in
-- (role anon); returns the id and the e-mail Supabase Auth checks the password against.
create or replace function app.login_lookup(identifier text)
returns table (user_id uuid, auth_email text)
language sql stable security definer set search_path = '' as $$
  select u.id, a.email::text
    from public.users u
    join auth.users a on a.id = u.id
   where u.cancelled_at is null
     and ((identifier ~ '^[0-9]{10}$' and u.mobile = identifier)
          or lower(a.email) = lower(identifier))
   limit 1;
$$;
--> statement-breakpoint
-- After a good password: stamp the signed-in user's last login (users may only change name/mobile).
create or replace function app.record_login() returns void
language sql security definer set search_path = '' as $$
  update public.users set last_login_at = now() where id = auth.uid();
$$;
--> statement-breakpoint
-- "+ Invite user": an existing login with this mobile / e-mail, so they just get the new company.
-- Only for people who manage a company.
create or replace function app.find_user(p_mobile text, p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.users u
   where u.cancelled_at is null
     and (u.mobile = p_mobile or (p_email is not null and lower(u.email) = lower(p_email)))
     and exists (select 1 from public.memberships m
                  where m.user_id = auth.uid() and m.cancelled_at is null
                    and app.can(m.company_id, 'company.manage'))
   limit 1;
$$;
--> statement-breakpoint
-- Password reset only for people whose every company the caller owns (same rule as
-- resetMemberPassword in lib/data/members.ts) — their other companies are invisible under RLS.
create or replace function app.can_reset_password(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not exists (
    select 1 from public.memberships m
     where m.user_id = target and m.cancelled_at is null
       and not exists (select 1 from public.memberships o
                        where o.user_id = auth.uid() and o.company_id = m.company_id
                          and o.role = 'owner' and o.cancelled_at is null));
$$;
--> statement-breakpoint
-- "A company with this GSTIN already exists" across all companies, not just the caller's.
create or replace function app.company_gstin_taken(p_gstin text, p_except uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.companies c
     where c.gstin = p_gstin and c.id is distinct from p_except and c.cancelled_at is null);
$$;
--> statement-breakpoint

-- Invited people without an e-mail get a placeholder Auth e-mail (Supabase Auth needs one);
-- users.email stays empty for them.
create or replace function app.tg_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  placeholder boolean := coalesce((new.raw_user_meta_data ->> 'email_placeholder')::boolean, false);
begin
  insert into public.users (id, name, email, mobile)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case when placeholder then null else new.email end,
    nullif(new.raw_user_meta_data ->> 'mobile', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
--> statement-breakpoint
create or replace function app.tg_auth_user_updated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((new.raw_user_meta_data ->> 'email_placeholder')::boolean, false) then
    return new;
  end if;
  update public.users set email = new.email, updated_at = now()
   where id = new.id and email is distinct from new.email;
  return new;
end $$;
--> statement-breakpoint

-- New functions are executable by PUBLIC by default; open each one only to who needs it.
revoke execute on function app.login_lookup(text), app.record_login(), app.find_user(text, text),
  app.can_reset_password(uuid), app.company_gstin_taken(text, uuid) from public;
--> statement-breakpoint
grant usage on schema app to anon;
--> statement-breakpoint
grant execute on function app.login_lookup(text) to anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function app.record_login(), app.find_user(text, text),
  app.can_reset_password(uuid), app.company_gstin_taken(text, uuid) to authenticated, service_role;
