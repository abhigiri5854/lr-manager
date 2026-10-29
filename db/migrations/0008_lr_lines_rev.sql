ALTER TABLE "lrs" ADD COLUMN "lines_rev" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- POD screen: the LR facts a POD save checks (date, booked, cancelled), for anyone who may record
-- POD on it — office roles on any LR, a driver only on their own trip (drivers can't read lrs).
create or replace function app.lr_pod_info(company uuid, lr uuid)
returns table (lr_no text, lr_date date, booked_at timestamptz, cancelled_at timestamptz,
               delivered_at timestamptz, dispatched_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.lr_no, l.lr_date, l.booked_at, l.cancelled_at, l.delivered_at, l.dispatched_at
    from public.lrs l
   where l.company_id = company and l.id = lr
     and (app.can(company, 'pod.upload')
          or (app.can(company, 'pod.upload_own') and app.is_own_trip(company, lr)));
$$;
--> statement-breakpoint
revoke execute on function app.lr_pod_info(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function app.lr_pod_info(uuid, uuid) to authenticated, service_role;
