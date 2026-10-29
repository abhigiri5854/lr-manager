// Smart import files and saved column mappings (docs/DATABASE.md §3.8).
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ImportReadResult } from "@/lib/import/types";
import type { ImportRowAction } from "@/lib/types";
import {
  businessColumns,
  businessConstraints,
  importDetectedAs,
  importFormat,
  importKind,
  importSource,
  importStatus,
  ts,
} from "./_common";
import { companies, users } from "./companies";

const byUser = () => users.id;

export const importBatches = pgTable(
  "import_batches",
  {
    ...businessColumns(byUser),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    source: importSource("source").notNull(),
    fileName: text("file_name").notNull(),
    filePath: text("file_path"),
    format: importFormat("format").notNull(),
    kind: importKind("kind").notNull(),
    mimeType: text("mime_type").notNull().default(""),
    sizeBytes: integer("size_bytes").notNull(),
    detectedAs: importDetectedAs("detected_as").notNull().default("unknown"),
    status: importStatus("status").notNull().default("uploaded"),
    error: text("error"),
    result: jsonb("result").$type<ImportReadResult>(),
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull().default({}),
    confirmedColumns: text("confirmed_columns").array().notNull().default(sql`'{}'::text[]`),
    mappingName: text("mapping_name"),
    rowActions: jsonb("row_actions").$type<Record<string, ImportRowAction>>().notNull().default({}),
    countValid: integer("count_valid").notNull().default(0),
    countWarning: integer("count_warning").notNull().default(0),
    countError: integer("count_error").notNull().default(0),
    createdRecords: jsonb("created_records")
      .$type<{ table: string; id: string }[]>()
      .notNull()
      .default([]),
    importedAt: ts("imported_at"),
  },
  (t) => [
    ...businessConstraints("import_batches", t),
    index("import_batches_company_created_idx").on(t.companyId, t.createdAt.desc()),
    index("import_batches_company_status_idx").on(t.companyId, t.status),
    index("import_batches_created_by_idx").on(t.createdBy),
  ],
).enableRLS();

export const importMappings = pgTable(
  "import_mappings",
  {
    ...businessColumns(byUser),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    columns: jsonb("columns").$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [
    ...businessConstraints("import_mappings", t),
    uniqueIndex("import_mappings_company_name_key")
      .on(t.companyId, sql`lower(${t.name})`)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();
