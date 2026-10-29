// Smart import files and saved mappings on the database (ImportStore, see ../import-store.ts).
import type { ImportBatch } from "@/lib/types";
import { normaliseVehicleNo } from "@/lib/validators/common";
import { ConflictError, NotFoundError } from "../errors";
import { getCurrentUserId } from "../session";
import type {
  ExistingInvoice,
  HistoryBatch,
  ImportKeys,
  ImportLookups,
  ImportStore,
} from "../import-store";
import { toPartyOption } from "../import-store";
import { paging, withUser, withUserRead, type Tx } from "./conn";
import { isUuid } from "./lrs";
import { audit, toImportBatch, toImportMapping, toParty, withAuditBatch, type Row } from "./rows";
import { importPathFromUrl } from "./storage";
import { cancelRow, textsIn } from "./write";

/** import_batches columns from the record (everything the import flow changes). */
function batchColumns(tx: Tx, b: ImportBatch): Row {
  return {
    source: b.source,
    file_name: b.fileName,
    format: b.format,
    kind: b.kind,
    mime_type: b.mimeType,
    size_bytes: b.sizeBytes,
    detected_as: b.detectedAs,
    status: b.status,
    error: b.error,
    result: b.result === null ? null : tx.json(b.result as never),
    mapping: tx.json(b.mapping as never),
    confirmed_columns: tx`(select coalesce(array_agg(x), '{}') from
                           jsonb_array_elements_text(${tx.json(b.confirmedColumns as never)}::jsonb) x)`,
    mapping_name: b.mappingName,
    row_actions: tx.json(b.rowActions as never),
    count_valid: b.counts.valid,
    count_warning: b.counts.warning,
    count_error: b.counts.error,
    created_records: tx.json(b.createdRecords as never),
    imported_at: b.importedAt,
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const dbImportStore: ImportStore = {
  read: (fn) => withUserRead(() => fn()),

  async importTx(batch, system, fn) {
    // "system" audit rows are allowed only for the user who uploaded the file (RLS).
    const me = system ? await getCurrentUserId() : null;
    return withUser(() =>
      withAuditBatch({ batchId: batch.id, system: system && me === batch.createdBy }, fn),
    );
  },

  async getBatch(companyId, id) {
    if (!isUuid(id)) return null;
    return withUserRead(async (tx) => {
      const [r] = await tx`select * from import_batches where company_id = ${companyId} and id = ${id}`;
      return r ? toImportBatch(r) : null;
    });
  },

  async openBatches(companyId) {
    return withUserRead(async (tx) => {
      const rows = await tx`select * from import_batches
                             where company_id = ${companyId} and cancelled_at is null
                               and status <> 'imported'
                             order by created_at desc, id`;
      return rows.map(toImportBatch);
    });
  },

  async history(companyId, params) {
    const { page, pageSize, offset } = paging(params);
    return withUserRead(async (tx) => {
      const where = () => tx`b.company_id = ${companyId} and b.cancelled_at is null
        and (b.status = 'imported' or (b.status = 'failed' and b.result is not null))`;
      const [rows, [{ n }]] = await Promise.all([
        tx`select b.*, u.name as by_name from import_batches b
             left join users u on u.id = b.created_by
            where ${where()}
            order by coalesce(b.imported_at, b.updated_at) desc, b.id
            limit ${pageSize} offset ${offset}`,
        tx`select count(*) as n from import_batches b where ${where()}`,
      ]);
      return {
        rows: rows.map((r): HistoryBatch => ({ ...toImportBatch(r), byName: r.by_name || null })),
        total: n as number,
        page,
        pageSize,
      };
    });
  },

  async insertBatch(b) {
    return withUser(async (tx) => {
      const [r] = await tx`insert into import_batches ${tx({
        id: b.id,
        company_id: b.companyId,
        created_by: b.createdBy,
        updated_by: b.createdBy,
        file_path: importPathFromUrl(b.companyId, b.fileUrl),
        ...batchColumns(tx, b),
      } as never)} returning *`;
      const saved = toImportBatch(r);
      audit(tx, b.companyId, "import_batches", b.id, "create", null, saved);
      return saved;
    });
  },

  async saveBatch(current, next) {
    return withUser(async (tx) => {
      const [r] = await tx`update import_batches set ${tx(batchColumns(tx, next) as never)}
                            where company_id = ${current.companyId} and id = ${current.id}
                              and version = ${current.version} and cancelled_at is null
                        returning *`;
      if (!r) throw new ConflictError();
      const saved = toImportBatch(r);
      audit(tx, current.companyId, "import_batches", current.id, "update", current, saved);
      return saved;
    });
  },

  async cancelBatch(companyId, id) {
    if (!isUuid(id)) throw new NotFoundError("Import file");
    await withUser(async (tx) => {
      const { before, after, changed } = await cancelRow(tx, "import_batches", companyId, id, "Import file");
      if (changed) {
        audit(tx, companyId, "import_batches", id, "cancel", toImportBatch(before), toImportBatch(after));
      }
    });
  },

  async mappings(companyId) {
    return withUserRead(async (tx) => {
      const rows = await tx`select * from import_mappings
                             where company_id = ${companyId} and cancelled_at is null
                             order by created_at, id`;
      return rows.map(toImportMapping);
    });
  },

  async mappingById(companyId, id) {
    if (!isUuid(id)) return null;
    return withUserRead(async (tx) => {
      const [r] = await tx`select * from import_mappings
                            where company_id = ${companyId} and id = ${id} and cancelled_at is null`;
      return r ? toImportMapping(r) : null;
    });
  },

  async upsertMapping(companyId, name, columns) {
    return withUser(async (tx) => {
      const [existing] = await tx`select * from import_mappings
                                   where company_id = ${companyId} and cancelled_at is null
                                     and lower(name) = lower(${name.trim()})
                                   for update`;
      if (existing && sameName(existing.name, name)) {
        const [r] = await tx`update import_mappings
                                set name = ${name}, columns = ${tx.json(columns as never)}
                              where company_id = ${companyId} and id = ${existing.id}
                          returning *`;
        const saved = toImportMapping(r);
        audit(tx, companyId, "import_mappings", saved.id, "update", toImportMapping(existing), saved);
        return saved;
      }
      const [r] = await tx`insert into import_mappings ${tx({
        company_id: companyId,
        name,
        columns: tx.json(columns as never),
      } as never)} returning *`;
      const saved = toImportMapping(r);
      audit(tx, companyId, "import_mappings", saved.id, "create", null, saved);
      return saved;
    });
  },

  async lrPrefix(companyId) {
    return withUserRead(async (tx) => {
      const [r] = await tx`select lr_prefix from companies where id = ${companyId}`;
      return (r?.lr_prefix as string) ?? "";
    });
  },

  async lookups(companyId, lrPrefix, keys) {
    return withUserRead((tx) => loadLookups(tx, companyId, lrPrefix, keys));
  },
};

const none = Promise.resolve([] as Row[]);

/** Everything the keys ask for, in one pipelined round trip. */
async function loadLookups(
  tx: Tx,
  companyId: string,
  lrPrefix: string,
  keys: ImportKeys,
): Promise<ImportLookups> {
  const [lrs, parties, trucks, invoices, items] = await Promise.all([
    keys.lrNos.size
      ? tx`select l.id, l.lr_no, l.cancelled_at,
                  exists (select 1 from freight_bill_lines fl
                           where fl.company_id = l.company_id and fl.lr_id = l.id
                             and fl.bill_cancelled_at is null) as billed
             from lrs l
            where l.company_id = ${companyId}
              and l.lr_no in ${textsIn(tx, [...keys.lrNos].map((n) => `${lrPrefix}${n}`))}`
      : none,
    keys.gstins.size || keys.names.size
      ? tx`select * from parties
            where company_id = ${companyId} and cancelled_at is null
              and (gstin in ${textsIn(tx, [...keys.gstins])}
                   or (not is_self and lower(trim(name)) in ${textsIn(tx, [...keys.names])}))
            order by created_at, id`
      : none,
    keys.trucks.size
      ? tx`select t.id, t.number, d.mobile as driver_mobile
             from trucks t
             left join drivers d on d.company_id = t.company_id and d.id = t.driver_id
            where t.company_id = ${companyId} and t.cancelled_at is null
              and t.number in ${textsIn(tx, [...keys.trucks])}`
      : none,
    keys.invoiceNos.size
      ? tx`select t.id, t.version, t.status, t.cancelled_at, t.invoice_no, s.gstin as seller_gstin
             from tax_invoices t
             join parties s on s.company_id = t.company_id and s.id = t.seller_party_id
            where t.company_id = ${companyId}
              and t.invoice_no in ${textsIn(tx, [...keys.invoiceNos])}
            order by t.created_at, t.id`
      : none,
    keys.itemCodes.size
      ? tx`select id, code from items
            where company_id = ${companyId} and cancelled_at is null
              and code in ${textsIn(tx, [...keys.itemCodes])}`
      : none,
  ]);

  const lrByNo = new Map((lrs as Row[]).map((r) => [r.lr_no as string, r]));
  const partyRows = (parties as Row[]).map(toParty);
  const truckByNo = new Map((trucks as Row[]).map((r) => [r.number as string, r]));
  const itemByCode = new Map((items as Row[]).map((r) => [r.code as string, r]));
  const invoiceRows = invoices as Row[];
  const invoiceFor = (no: string, gstin: string | null, live: boolean) =>
    gstin
      ? invoiceRows.find(
          (r) => r.invoice_no === no && r.seller_gstin === gstin && (!live || !r.cancelled_at),
        )
      : undefined;

  return {
    lrPrefix,
    lrByNo(lrNo) {
      const r = lrByNo.get(`${lrPrefix}${lrNo}`);
      if (!r) return null;
      const status = r.cancelled_at ? "Cancelled" : r.billed ? "Billed" : "in the register";
      return { id: r.id, status, updatable: !r.cancelled_at && !r.billed };
    },
    partyByGstin(gstin) {
      const p = partyRows.find((x) => x.gstin === gstin);
      return p ? toPartyOption(p) : null;
    },
    partyByName(name) {
      const p = partyRows.find((x) => !x.isSelf && sameName(x.name, name));
      return p ? toPartyOption(p) : null;
    },
    truckByNumber(number) {
      const r = truckByNo.get(normaliseVehicleNo(number));
      return r ? { id: r.id, number: r.number, driverMobile: r.driver_mobile ?? null, lastLrNo: null } : null;
    },
    itemByCode(code) {
      const r = itemByCode.get(code.toUpperCase());
      return r ? { id: r.id } : null;
    },
    taxInvoice(invoiceNo, gstin) {
      const r = invoiceFor(invoiceNo, gstin, true);
      return r ? { id: r.id } : null;
    },
    existingInvoice(invoiceNo, gstin): ExistingInvoice | null {
      const r = invoiceFor(invoiceNo, gstin, false);
      return r
        ? {
            id: r.id,
            version: r.version,
            status: r.status,
            cancelled: !!r.cancelled_at,
            invoiceNo: r.invoice_no,
          }
        : null;
    },
  };
}
