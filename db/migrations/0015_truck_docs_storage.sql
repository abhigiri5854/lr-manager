-- Hand-written. Private `truck-docs` bucket for market-truck party files (UPI QR images and TDS
-- declarations; TIER1-MARKET-TRUCKS.md §5, §9 #8). Object path: {company_id}/{uuid}-{file name}.
-- Same shape as 0004_storage.sql: files are never deleted, so there are no update / delete policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('truck-docs', 'truck-docs', false, 3145728, array['image/*', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
--> statement-breakpoint
create policy lr_manager_truck_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'truck-docs' and app.is_office(app.path_part(name, 1)));
--> statement-breakpoint
create policy lr_manager_truck_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'truck-docs' and app.can(app.path_part(name, 1), 'master.edit'));
