-- Hand-written. role_permissions seeded from PERMISSIONS in lib/permissions.ts (the single source of
-- truth). db/tests/permissions.db.test.ts fails if the two ever differ; to change a grant, edit the
-- TS map and add a migration that updates this table.
insert into public.role_permissions (role, action) values
  ('owner', 'lr.edit'),
  ('owner', 'invoice.edit'),
  ('owner', 'bill.edit'),
  ('owner', 'record.cancel'),
  ('owner', 'company.manage'),
  ('owner', 'import.run'),
  ('owner', 'pod.upload'),
  ('owner', 'freight.view'),
  ('owner', 'master.edit'),
  ('accountant', 'invoice.edit'),
  ('accountant', 'bill.edit'),
  ('accountant', 'import.run'),
  ('accountant', 'freight.view'),
  ('accountant', 'master.edit'),
  ('booking_staff', 'lr.edit'),
  ('booking_staff', 'invoice.edit'),
  ('booking_staff', 'import.run'),
  ('booking_staff', 'pod.upload'),
  ('booking_staff', 'freight.view'),
  ('booking_staff', 'master.edit'),
  ('driver', 'pod.upload_own')
on conflict do nothing;
