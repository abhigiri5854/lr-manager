CREATE TABLE "import_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"seller_gstin" text NOT NULL,
	"field" text NOT NULL,
	"wrong_value" text NOT NULL,
	"correct_value" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_corrections" ADD CONSTRAINT "import_corrections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_corrections_key" ON "import_corrections" USING btree ("company_id","seller_gstin","field","wrong_value","correct_value");--> statement-breakpoint
CREATE INDEX "import_corrections_recent_idx" ON "import_corrections" USING btree ("company_id","seller_gstin","updated_at" DESC NULLS LAST);--> statement-breakpoint

-- Hand-written. Same rules as the other import tables: company members who may run imports, no deletes.
revoke all on public.import_corrections from anon;--> statement-breakpoint
revoke delete, truncate on public.import_corrections from authenticated;--> statement-breakpoint
create policy import_corrections_select on public.import_corrections for select to authenticated
  using (app.can(company_id, 'import.run'));--> statement-breakpoint
create policy import_corrections_insert on public.import_corrections for insert to authenticated
  with check (app.can(company_id, 'import.run'));--> statement-breakpoint
create policy import_corrections_update on public.import_corrections for update to authenticated
  using (app.can(company_id, 'import.run')) with check (app.can(company_id, 'import.run'));--> statement-breakpoint

-- Company wipe (test / reset helper) must clear the new table first.
do $$
declare
  def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'purge_company' and n.nspname in ('app', 'public') limit 1;
  if def is not null and def not like '%import_corrections%' then
    execute replace(def,
      'delete from public.import_mappings where company_id = company;',
      'delete from public.import_corrections where company_id = company;' || E'\n  ' ||
      'delete from public.import_mappings where company_id = company;');
  end if;
end $$;
