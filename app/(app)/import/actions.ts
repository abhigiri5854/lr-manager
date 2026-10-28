"use server";

import { refresh } from "next/cache";
import { toActionFailure, type ActionFailure } from "@/lib/data/errors";
import {
  applyImportMapping,
  commitExcelBatch,
  removeImportBatch,
  saveImportMapping,
  setColumnMapping,
  setRowAction,
  type CommitSummary,
} from "@/lib/data/import";
import { getActiveCompanyId } from "@/lib/data/session";
import type { ImportRowAction } from "@/lib/types";

// Smart import. Who may do what is checked in lib/data (import.run, plus lr.edit for Excel).

type Done = { ok: true } | ActionFailure;

async function run(work: (companyId: string) => Promise<void>): Promise<Done> {
  try {
    await work(await getActiveCompanyId());
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionFailure(e);
  }
}

export async function removeFileAction(batchId: string): Promise<Done> {
  return run((c) => removeImportBatch(c, batchId));
}

export async function setColumnMappingAction(
  batchId: string,
  header: string,
  field: string,
): Promise<Done> {
  return run((c) => setColumnMapping(c, batchId, header, field));
}

export async function setRowActionAction(
  batchId: string,
  rowNo: number,
  action: ImportRowAction,
): Promise<Done> {
  return run((c) => setRowAction(c, batchId, rowNo, action));
}

export async function saveMappingAction(batchId: string, name: string): Promise<Done> {
  return run(async (c) => void (await saveImportMapping(c, batchId, name)));
}

export async function applyMappingAction(batchId: string, mappingId: string): Promise<Done> {
  return run((c) => applyImportMapping(c, batchId, mappingId));
}

/** "Import valid rows". */
export async function commitBatchAction(
  batchId: string,
): Promise<{ ok: true; summary: CommitSummary } | ActionFailure> {
  try {
    const summary = await commitExcelBatch(await getActiveCompanyId(), batchId);
    refresh();
    return { ok: true, summary };
  } catch (e) {
    refresh();
    return toActionFailure(e);
  }
}
