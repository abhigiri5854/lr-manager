// Append-only change log, written by lib/data in the same transaction (docs/DATABASE.md §3.9).
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { AuditEntry } from "@/lib/types";
import { auditAction, auditActor, companyFk, ts } from "./_common";
import { companies, users } from "./companies";
import { importBatches } from "./imports";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    actor: auditActor("actor").notNull(),
    userId: uuid("user_id").references(() => users.id),
    batchId: uuid("batch_id"),
    tableName: text("table_name").notNull(),
    recordId: uuid("record_id").notNull(),
    action: auditAction("action").notNull(),
    changes: jsonb("changes").$type<AuditEntry["changes"]>().notNull().default([]),
  },
  (t) => [
    check("audit_log_actor_check", sql`(actor = 'user') = (user_id is not null)`),
    ...companyFk("audit_log_batch", t.companyId, t.batchId, importBatches),
    index("audit_log_record_idx").on(t.companyId, t.tableName, t.recordId, t.createdAt.desc()),
  ],
).enableRLS();
