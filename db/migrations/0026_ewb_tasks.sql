-- Hand-written. E-way checklist (TIER1-MARKET-TRUCKS.md D12 / T1-11): distance per challan line
-- (computed e-way expiry) and "Update Part-B" tasks created when a dispatched challan changes vehicle.
-- RLS copies 0014: office users of the company read; master.edit inserts / updates; no deletes.

alter table public.challan_lrs add column ewb_distance_km integer;
--> statement-breakpoint
alter table public.challan_lrs add constraint challan_lrs_ewb_distance_check
  check (ewb_distance_km is null or ewb_distance_km >= 0);
--> statement-breakpoint

create table public.ewb_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  challan_id uuid not null,
  lr_id uuid not null,
  ewb_no text,
  old_vehicle_id uuid,
  new_vehicle_id uuid not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  done_at timestamptz,
  done_by uuid references public.users (id),
  constraint ewb_tasks_done_check check ((done_at is null) = (done_by is null)),
  constraint ewb_tasks_challan_fk foreign key (company_id, challan_id)
    references public.challans (company_id, id),
  constraint ewb_tasks_lr_fk foreign key (company_id, lr_id)
    references public.lrs (company_id, id),
  constraint ewb_tasks_old_vehicle_fk foreign key (company_id, old_vehicle_id)
    references public.market_vehicles (company_id, id),
  constraint ewb_tasks_new_vehicle_fk foreign key (company_id, new_vehicle_id)
    references public.market_vehicles (company_id, id)
);
--> statement-breakpoint
create index ewb_tasks_open_idx on public.ewb_tasks (company_id, created_at desc)
  where done_at is null;
--> statement-breakpoint
create index ewb_tasks_challan_idx on public.ewb_tasks (company_id, challan_id);
--> statement-breakpoint
alter table public.ewb_tasks enable row level security;
--> statement-breakpoint

revoke all on public.ewb_tasks from anon;
--> statement-breakpoint
revoke delete, truncate on public.ewb_tasks from authenticated;
--> statement-breakpoint
grant select, insert, update on public.ewb_tasks to authenticated;
--> statement-breakpoint
create policy ewb_tasks_select on public.ewb_tasks for select to authenticated
  using (app.is_office(company_id));
--> statement-breakpoint
create policy ewb_tasks_insert on public.ewb_tasks for insert to authenticated
  with check (app.can(company_id, 'master.edit'));
--> statement-breakpoint
create policy ewb_tasks_update on public.ewb_tasks for update to authenticated
  using (app.can(company_id, 'master.edit')) with check (app.can(company_id, 'master.edit'));
--> statement-breakpoint
create trigger z_no_delete before delete on public.ewb_tasks
  for each row execute function app.tg_no_delete();
--> statement-breakpoint

-- Company wipe (test / reset helper) must clear the new table before challan_lrs.
do $$
declare
  def text;
  new_def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'purge_company' and n.nspname in ('app', 'public') limit 1;
  if def is null then
    raise exception 'purge_company() not found: cannot add ewb_tasks to the company wipe';
  end if;
  new_def := replace(def,
    'delete from public.challan_lrs where company_id = company;',
    'delete from public.ewb_tasks where company_id = company;' || E'\n  ' ||
    'delete from public.challan_lrs where company_id = company;');
  if new_def = def then
    raise exception 'purge_company() text did not change: the challan_lrs delete line was not found';
  end if;
  execute new_def;
end $$;
