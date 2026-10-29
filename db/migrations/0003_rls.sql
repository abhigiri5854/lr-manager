-- Hand-written. Row Level Security (docs/DATABASE.md §6). RLS is enabled on every table by the
-- tables migration; these are the policies. No DELETE policy anywhere except draft line
-- replacement; anon gets nothing.

-- ---------- table privileges ----------
revoke all on all tables in schema public from anon;
--> statement-breakpoint
revoke delete, truncate on all tables in schema public from authenticated;
--> statement-breakpoint
grant delete on public.lr_items, public.lr_invoices, public.tax_invoice_lines,
                public.freight_bill_lines, public.payment_allocations to authenticated;
--> statement-breakpoint
revoke insert, update on public.audit_log from authenticated;
--> statement-breakpoint
grant insert on public.audit_log to authenticated;
--> statement-breakpoint
revoke insert, update on public.role_permissions, public.number_series from authenticated;
--> statement-breakpoint
revoke insert on public.companies from authenticated;
--> statement-breakpoint
revoke insert, update on public.users from authenticated;
--> statement-breakpoint
grant update (name, mobile) on public.users to authenticated;
--> statement-breakpoint
grant select on public.freight_bill_balances to authenticated;
--> statement-breakpoint

-- ---------- companies & people ----------
create policy companies_select on public.companies for select to authenticated
  using (app.is_member(id));
--> statement-breakpoint
create policy companies_update on public.companies for update to authenticated
  using (app.can(id, 'company.manage')) with check (app.can(id, 'company.manage'));
--> statement-breakpoint
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or app.shares_company(id));
--> statement-breakpoint
create policy users_update on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
--> statement-breakpoint
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or app.is_office(company_id));
--> statement-breakpoint
create policy memberships_insert on public.memberships for insert to authenticated
  with check (app.can(company_id, 'company.manage'));
--> statement-breakpoint
create policy memberships_update on public.memberships for update to authenticated
  using (app.can(company_id, 'company.manage')) with check (app.can(company_id, 'company.manage'));
--> statement-breakpoint
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (true);
--> statement-breakpoint
create policy number_series_select on public.number_series for select to authenticated
  using (app.is_office(company_id));
--> statement-breakpoint

-- ---------- masters: office roles read, master.edit writes ----------
do $$
declare
  t text;
begin
  foreach t in array array['parties', 'drivers', 'trucks', 'items'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.is_office(company_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.can(company_id, %L))', t || '_insert', t, 'master.edit');
    execute format('create policy %I on public.%I for update to authenticated using (app.can(company_id, %L)) with check (app.can(company_id, %L))', t || '_update', t, 'master.edit', 'master.edit');
  end loop;
end $$;
--> statement-breakpoint

-- ---------- LR ----------
create policy lrs_select on public.lrs for select to authenticated
  using (app.is_office(company_id) and app.can(company_id, 'freight.view'));
--> statement-breakpoint
create policy lrs_insert on public.lrs for insert to authenticated
  with check (app.can(company_id, 'lr.edit'));
--> statement-breakpoint
-- pod.upload / own trip may update too; the column guard trigger limits them to delivery.
create policy lrs_update on public.lrs for update to authenticated
  using (app.can(company_id, 'lr.edit') or app.can(company_id, 'pod.upload')
         or (app.can(company_id, 'pod.upload_own') and app.is_own_trip(company_id, id)))
  with check (app.can(company_id, 'lr.edit') or app.can(company_id, 'pod.upload')
         or (app.can(company_id, 'pod.upload_own') and app.is_own_trip(company_id, id)));
--> statement-breakpoint
do $$
declare
  t text;
begin
  foreach t in array array['lr_items', 'lr_invoices'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.is_office(company_id) and app.can(company_id, %L))', t || '_select', t, 'freight.view');
    execute format('create policy %I on public.%I for insert to authenticated with check (app.can(company_id, %L))', t || '_insert', t, 'lr.edit');
    execute format('create policy %I on public.%I for update to authenticated using (app.can(company_id, %L)) with check (app.can(company_id, %L))', t || '_update', t, 'lr.edit', 'lr.edit');
    -- Draft line replacement: only while the LR is live and not billed.
    execute format($f$create policy %I on public.%I for delete to authenticated using (
      app.can(company_id, 'lr.edit') and exists (
        select 1 from public.lrs l where l.company_id = %I.company_id and l.id = %I.lr_id
           and l.cancelled_at is null and l.billed_at is null))$f$, t || '_delete', t, t, t);
  end loop;
end $$;
--> statement-breakpoint

-- ---------- tax invoices ----------
create policy tax_invoices_select on public.tax_invoices for select to authenticated
  using (app.is_office(company_id));
--> statement-breakpoint
create policy tax_invoices_insert on public.tax_invoices for insert to authenticated
  with check (app.can(company_id, 'invoice.edit'));
--> statement-breakpoint
create policy tax_invoices_update on public.tax_invoices for update to authenticated
  using (app.can(company_id, 'invoice.edit')) with check (app.can(company_id, 'invoice.edit'));
--> statement-breakpoint
create policy tax_invoice_lines_select on public.tax_invoice_lines for select to authenticated
  using (app.is_office(company_id));
--> statement-breakpoint
create policy tax_invoice_lines_insert on public.tax_invoice_lines for insert to authenticated
  with check (app.can(company_id, 'invoice.edit'));
--> statement-breakpoint
create policy tax_invoice_lines_update on public.tax_invoice_lines for update to authenticated
  using (app.can(company_id, 'invoice.edit')) with check (app.can(company_id, 'invoice.edit'));
--> statement-breakpoint
create policy tax_invoice_lines_delete on public.tax_invoice_lines for delete to authenticated
  using (app.can(company_id, 'invoice.edit') and exists (
    select 1 from public.tax_invoices t
     where t.company_id = tax_invoice_lines.company_id and t.id = tax_invoice_lines.tax_invoice_id
       and t.status = 'draft' and t.cancelled_at is null));
--> statement-breakpoint

-- ---------- POD ----------
create policy pods_select on public.pods for select to authenticated
  using (app.is_office(company_id) or app.is_own_trip(company_id, lr_id));
--> statement-breakpoint
create policy pods_insert on public.pods for insert to authenticated
  with check (app.can(company_id, 'pod.upload')
              or (app.can(company_id, 'pod.upload_own') and app.is_own_trip(company_id, lr_id)));
--> statement-breakpoint
create policy pods_update on public.pods for update to authenticated
  using (app.can(company_id, 'pod.upload')
         or (app.can(company_id, 'pod.upload_own') and app.is_own_trip(company_id, lr_id)))
  with check (app.can(company_id, 'pod.upload')
              or (app.can(company_id, 'pod.upload_own') and app.is_own_trip(company_id, lr_id)));
--> statement-breakpoint

-- ---------- freight bills & payments: freight.view reads, bill.edit writes ----------
do $$
declare
  t text;
begin
  foreach t in array array['freight_bills', 'freight_bill_lines', 'payments', 'payment_allocations'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.can(company_id, %L))', t || '_select', t, 'freight.view');
    execute format('create policy %I on public.%I for insert to authenticated with check (app.can(company_id, %L))', t || '_insert', t, 'bill.edit');
    execute format('create policy %I on public.%I for update to authenticated using (app.can(company_id, %L)) with check (app.can(company_id, %L))', t || '_update', t, 'bill.edit', 'bill.edit');
  end loop;
end $$;
--> statement-breakpoint
create policy freight_bill_lines_delete on public.freight_bill_lines for delete to authenticated
  using (app.can(company_id, 'bill.edit') and exists (
    select 1 from public.freight_bills b
     where b.company_id = freight_bill_lines.company_id and b.id = freight_bill_lines.freight_bill_id
       and b.status = 'draft' and b.cancelled_at is null));
--> statement-breakpoint
create policy payment_allocations_delete on public.payment_allocations for delete to authenticated
  using (app.can(company_id, 'bill.edit') and exists (
    select 1 from public.payments p
     where p.company_id = payment_allocations.company_id and p.id = payment_allocations.payment_id
       and p.cancelled_at is null));
--> statement-breakpoint

-- ---------- Smart import ----------
do $$
declare
  t text;
begin
  foreach t in array array['import_batches', 'import_mappings'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.can(company_id, %L))', t || '_select', t, 'import.run');
    execute format('create policy %I on public.%I for insert to authenticated with check (app.can(company_id, %L))', t || '_insert', t, 'import.run');
    execute format('create policy %I on public.%I for update to authenticated using (app.can(company_id, %L)) with check (app.can(company_id, %L))', t || '_update', t, 'import.run', 'import.run');
  end loop;
end $$;
--> statement-breakpoint

-- ---------- audit log: office reads; you write rows as yourself, or as system for your import ----------
create policy audit_log_select on public.audit_log for select to authenticated
  using (app.is_office(company_id));
--> statement-breakpoint
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (
    app.is_member(company_id) and (
      (actor = 'user' and user_id = auth.uid())
      or (actor = 'system' and batch_id is not null and exists (
            select 1 from public.import_batches b
             where b.company_id = audit_log.company_id and b.id = audit_log.batch_id
               and b.created_by = auth.uid()))));
