// Truck parties (market-truck owners / brokers) and their TDS declarations, on the database.
import type { Page, TdsDeclaration, TruckParty } from "@/lib/types";
import type { TdsDeclarationInput, TruckPartyValues } from "@/lib/validators/truck-party";
import { truckPartyRuleErrors } from "@/lib/validators/truck-party";
import { assertRules, newId } from "../_store";
import type { TruckPartyListParams, TruckPartyRow } from "../truck-parties";
import { contains, paging, withUser, withUserRead, type Tx } from "./conn";
import { audit, toTdsDeclaration, toTruckParty } from "./rows";
import { truckDocPathFromUrl } from "./storage";
import { check, columns, insertRow, saveRow, type Fragment } from "./write";

const PARTY_COLUMNS: Partial<Record<keyof TruckParty, string>> = {
  role: "role",
  name: "name",
  mobile: "mobile",
  altMobile: "alt_mobile",
  pan: "pan",
  gstin: "gstin",
  address: "address",
  bankName: "bank_name",
  accountHolder: "account_holder",
  accountNo: "account_no",
  ifsc: "ifsc",
  upiId: "upi_id",
  status: "status",
  blacklistReason: "blacklist_reason",
  notes: "notes",
};

/** "••••1234": audit rows never hold a full account number. */
const maskAccount = (n: string | null) => (n ? `••••${n.slice(-4)}` : null);

/** The record as audit_log sees it. A changed account number shows as changed even if the last 4 match. */
function auditPair(before: TruckParty | null, after: TruckParty) {
  const view = (p: TruckParty) => ({ ...p, accountNo: maskAccount(p.accountNo) });
  const b = before ? view(before) : null;
  const a = view(after);
  if (before && before.accountNo !== after.accountNo && b?.accountNo === a.accountNo) {
    a.accountNo = `${a.accountNo} (changed)`;
  }
  return { before: b, after: a };
}

function gstinCheck(tx: Tx, companyId: string, gstin: string | Fragment, exceptId?: string) {
  return tx`select 'gstin'::text as field, 'GSTIN already saved for ' || name as msg from truck_parties
             where company_id = ${companyId} and gstin = ${gstin}
               and cancelled_at is null and id is distinct from ${exceptId ?? null}
             limit 1`;
}

export async function listTruckPartyRows(
  companyId: string,
  params: TruckPartyListParams,
): Promise<Page<TruckPartyRow>> {
  const { page, pageSize, offset } = paging(params);
  const q = contains(params.search);
  return withUserRead(async (tx) => {
    const where = () => tx`p.company_id = ${companyId} and p.cancelled_at is null
                           ${q ? tx`and p.search_text like ${q}` : tx``}`;
    const [rows, [{ n }]] = await Promise.all([
      tx`select p.*, d.fy as latest_tds_fy from truck_parties p
          left join lateral (
            select fy from tds_declarations d
             where d.company_id = p.company_id and d.party_id = p.id and d.cancelled_at is null
             order by fy desc limit 1) d on true
          where ${where()}
          order by lower(p.name), p.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from truck_parties p where ${where()}`,
    ]);
    return {
      rows: rows.map((r) => ({
        ...toTruckParty(r),
        latestTdsFy: (r.latest_tds_fy as string | null) ?? null,
      })),
      total: n as number,
      page,
      pageSize,
    };
  });
}

export async function insertTruckParty(
  companyId: string,
  v: TruckPartyValues,
  userId: string,
): Promise<TruckParty> {
  const id = newId();
  return withUser(async (tx) => {
    const r = await insertRow(
      tx,
      "truck_parties",
      {
        id,
        company_id: companyId,
        ...columns(v, PARTY_COLUMNS),
        upi_qr_file: truckDocPathFromUrl(companyId, v.upiQrUrl),
        verified: v.verified,
        verified_by: v.verified ? userId : null,
        verified_at: v.verified ? new Date().toISOString() : null,
      },
      { checks: v.gstin ? [gstinCheck(tx, companyId, v.gstin)] : [] },
    );
    const saved = toTruckParty(r);
    const a = auditPair(null, saved);
    audit(tx, companyId, "truck_parties", saved.id, "create", a.before, a.after);
    return saved;
  });
}

export async function updateTruckParty(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<TruckPartyValues>,
): Promise<TruckParty> {
  return withUser(async (tx) => {
    const gstin = "gstin" in patch ? (patch.gstin ?? null) : tx`(select gstin from cur)`;
    const set = columns(patch, PARTY_COLUMNS);
    if ("upiQrUrl" in patch) set.upi_qr_file = truckDocPathFromUrl(companyId, patch.upiQrUrl);
    if (patch.verified === true) {
      // Keep who / when verified if it already was; stamp only on the switch to verified.
      set.verified = true;
      set.verified_by = tx`(case when cur.verified then cur.verified_by else auth.uid() end)`;
      set.verified_at = tx`(case when cur.verified then cur.verified_at else now() end)`;
    } else if (patch.verified === false) {
      set.verified = false;
      set.verified_by = null;
      set.verified_at = null;
    }
    const { before, after } = await saveRow(tx, "truck_parties", companyId, id, expectedVersion, set, {
      what: "Truck party",
      checks: gstin === null ? [] : [gstinCheck(tx, companyId, gstin, id)],
      validate: (row) => {
        const current = toTruckParty(row);
        assertRules(truckPartyRuleErrors({ ...current, ...patch }));
      },
    });
    const saved = toTruckParty(after);
    const a = auditPair(toTruckParty(before), saved);
    audit(tx, companyId, "truck_parties", id, "update", a.before, a.after);
    return saved;
  });
}

export async function listTdsDeclarations(
  companyId: string,
  partyId: string,
): Promise<TdsDeclaration[]> {
  return withUserRead(async (tx) => {
    const rows = await tx`select * from tds_declarations
                           where company_id = ${companyId} and party_id = ${partyId}
                             and cancelled_at is null
                           order by fy desc`;
    return rows.map(toTdsDeclaration);
  });
}

export async function insertTdsDeclaration(
  companyId: string,
  v: Omit<TdsDeclarationInput, "partyId"> & { partyId: string },
): Promise<TdsDeclaration> {
  return withUser(async (tx) => {
    const r = await insertRow(
      tx,
      "tds_declarations",
      {
        id: newId(),
        company_id: companyId,
        party_id: v.partyId,
        fy: v.fy,
        file_url: truckDocPathFromUrl(companyId, v.fileUrl as string | null | undefined),
        vehicles_owned_declared: (v.vehiclesOwnedDeclared as number | null | undefined) ?? null,
        received_on: (v.receivedOn as string | null | undefined) ?? null,
      },
      {
        checks: [
          check(
            tx,
            "partyId",
            "Truck party not found in this company",
            tx`not exists (select 1 from truck_parties where company_id = ${companyId}
                             and id = ${v.partyId} and cancelled_at is null)`,
          ),
          check(
            tx,
            "fy",
            `A declaration for ${v.fy} is already saved`,
            tx`exists (select 1 from tds_declarations where company_id = ${companyId}
                         and party_id = ${v.partyId} and fy = ${v.fy} and cancelled_at is null)`,
          ),
        ],
      },
    );
    const saved = toTdsDeclaration(r);
    audit(tx, companyId, "tds_declarations", saved.id, "create", null, saved);
    return saved;
  });
}
