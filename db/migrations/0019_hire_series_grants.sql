-- Hand-written. 0014 revoked insert / update on hire_number_series from authenticated (counters were
-- meant to move only through app.allocate_hire_number) and created only a select policy, so the
-- Hire masters -> Number series tab failed with "permission denied for table hire_number_series".
-- Owners edit prefix / padding / next number there (the app refuses to lower next_no), so give the
-- table the same privileges and master.edit policies as the other hire masters.
-- Allocation is security definer and unaffected. Still no delete (0014 revoke + z_no_delete trigger).
grant select, insert, update on public.hire_number_series to authenticated;
--> statement-breakpoint
create policy hire_number_series_insert on public.hire_number_series for insert to authenticated
  with check (app.can(company_id, 'master.edit'));
--> statement-breakpoint
create policy hire_number_series_update on public.hire_number_series for update to authenticated
  using (app.can(company_id, 'master.edit')) with check (app.can(company_id, 'master.edit'));
--> statement-breakpoint

-- The counter only moves up (numbers below it are already issued) and a series can't be re-pointed at
-- another company / branch / financial year / document type. Prefix and padding may change.
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
create trigger b_series_guard before update on public.hire_number_series
  for each row execute function app.tg_hire_series_guard();
