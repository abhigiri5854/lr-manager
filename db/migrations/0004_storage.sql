-- Hand-written. Supabase Storage (docs/DATABASE.md §8): four private buckets; object paths are
-- {company_id}/{record_id}/{uuid}-{file name}. Files are never deleted, so there are no update /
-- delete policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('logos', 'logos', false, 2097152, array['image/png', 'image/svg+xml', 'image/jpeg']),
  ('signatures', 'signatures', false, 2097152, array['image/png', 'image/svg+xml', 'image/jpeg']),
  ('pod', 'pod', false, 3145728, array['image/*', 'application/pdf']),
  ('imports', 'imports', false, 10485760, array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel', 'text/csv', 'application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
--> statement-breakpoint

-- logos: company logo at {company}/{company}/…, party logos at {company}/{party}/….
create policy lr_manager_logos_select on storage.objects for select to authenticated
  using (bucket_id = 'logos' and app.is_office(app.path_part(name, 1)));
--> statement-breakpoint
create policy lr_manager_logos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos' and (
      (app.path_part(name, 2) = app.path_part(name, 1)
         and app.can(app.path_part(name, 1), 'company.manage'))
      or (app.path_part(name, 2) <> app.path_part(name, 1)
         and app.can(app.path_part(name, 1), 'master.edit'))));
--> statement-breakpoint
create policy lr_manager_signatures_select on storage.objects for select to authenticated
  using (bucket_id = 'signatures' and app.is_office(app.path_part(name, 1)));
--> statement-breakpoint
create policy lr_manager_signatures_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures' and app.can(app.path_part(name, 1), 'company.manage'));
--> statement-breakpoint
-- pod: {company}/{lr}/… so a driver's own-trip check can use the LR id.
create policy lr_manager_pod_select on storage.objects for select to authenticated
  using (bucket_id = 'pod' and (
    app.is_office(app.path_part(name, 1))
    or app.is_own_trip(app.path_part(name, 1), app.path_part(name, 2))));
--> statement-breakpoint
create policy lr_manager_pod_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pod' and (
    app.can(app.path_part(name, 1), 'pod.upload')
    or (app.can(app.path_part(name, 1), 'pod.upload_own')
        and app.is_own_trip(app.path_part(name, 1), app.path_part(name, 2)))));
--> statement-breakpoint
create policy lr_manager_imports_select on storage.objects for select to authenticated
  using (bucket_id = 'imports' and app.can(app.path_part(name, 1), 'import.run'));
--> statement-breakpoint
create policy lr_manager_imports_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'imports' and app.can(app.path_part(name, 1), 'import.run'));
