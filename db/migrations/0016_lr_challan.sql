-- Hand-written. An LR loaded on a dispatched market-truck challan is stamped dispatched by the challan,
-- not by an own-fleet truck; this keeps which challan did it (lib/data/db/lrs.ts dispatchLrOnChallan).
-- Not a foreign key in Drizzle (db/schema/lrs.ts can't import challans without a cycle), only here.
alter table "lrs" add column "challan_id" uuid;
--> statement-breakpoint
alter table "lrs" add constraint "lrs_challan_fk" foreign key ("company_id","challan_id") references "public"."challans"("company_id","id") on delete no action on update no action;
--> statement-breakpoint
create index "lrs_company_challan_idx" on "lrs" using btree ("company_id","challan_id") where challan_id is not null;
