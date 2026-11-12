-- Hand-written. 0019 let master.edit (incl. booking staff / accountants) create and edit hire number
-- series. Counters decide issued challan / payment numbers, so writes are Owner-only, the same
-- permission that guards the hire Settings tab (company.manage). Select policy is unchanged.
drop policy if exists hire_number_series_insert on public.hire_number_series;
--> statement-breakpoint
drop policy if exists hire_number_series_update on public.hire_number_series;
--> statement-breakpoint
create policy hire_number_series_insert on public.hire_number_series for insert to authenticated
  with check (app.can(company_id, 'company.manage'));
--> statement-breakpoint
create policy hire_number_series_update on public.hire_number_series for update to authenticated
  using (app.can(company_id, 'company.manage')) with check (app.can(company_id, 'company.manage'));
