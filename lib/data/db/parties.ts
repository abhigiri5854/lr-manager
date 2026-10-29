// Parties on the database (DATA_SOURCE=db). Same behaviour as the mock half of ../parties.ts.
import { SELF_PARTY_LOCKED } from "@/lib/self-party";
import type { Page, Party } from "@/lib/types";
import { normaliseGstin } from "@/lib/validators/common";
import { partyRuleErrors } from "@/lib/validators/party";
import { assertRules, fail } from "../_store";
import { NotFoundError } from "../errors";
import { contains, paging, withUser, withUserRead, type Tx } from "./conn";
import { audit, toParty, type Row } from "./rows";
import { cancelRow, columns, insertRow, saveRow, type Fragment } from "./write";
import type { PartyListParams, PartyStats, PartyUsage, ShipsTo } from "../parties";

/** Party fields → parties columns (logoUrl is a plain value until party logos are uploaded). */
const PARTY_COLUMNS: Partial<Record<keyof Party, string>> = {
  name: "name",
  place: "place",
  gstin: "gstin",
  pan: "pan",
  phone: "phone",
  address: "address",
  stateCode: "state_code",
  pincode: "pincode",
  logoUrl: "logo_path",
  defaultFrom: "default_from",
  defaultPaymentMode: "default_payment_mode",
  defaultGstPayer: "default_gst_payer",
  defaultChargedAs: "default_charged_as",
  source: "source",
};

/** "GSTIN already saved for …" when another active party has it (runs inside the save). */
function gstinCheck(
  tx: Tx,
  companyId: string,
  gstin: string | Fragment,
  exceptId?: string,
) {
  return tx`select 'gstin'::text as field, 'GSTIN already saved for ' || name as msg from parties
             where company_id = ${companyId} and gstin = ${gstin}
               and cancelled_at is null and id is distinct from ${exceptId ?? null}
             limit 1`;
}

export async function listParties(
  companyId: string,
  params: PartyListParams,
): Promise<Page<Party>> {
  return listPartyPage(companyId, params, false);
}

/** The Parties list page: each party with its LR count and last LR date, one round trip. */
export async function listPartyRows(
  companyId: string,
  params: PartyListParams,
): Promise<Page<Party & PartyStats>> {
  return listPartyPage(companyId, params, true);
}

async function listPartyPage<S extends boolean>(
  companyId: string,
  params: PartyListParams,
  stats: S,
): Promise<Page<S extends true ? Party & PartyStats : Party>> {
  const { page, pageSize, offset } = paging(params);
  const q = contains(params.search);
  return withUserRead(async (tx) => {
    const where = () => tx`p.company_id = ${companyId}
                           ${params.includeCancelled ? tx`` : tx`and p.cancelled_at is null`}
                           ${q ? tx`and p.search_text like ${q}` : tx``}`;
    const statsJoin = stats
      ? tx`, s.lr_count, s.last_lr_date from parties p
           left join lateral (
             select count(*) as lr_count, max(l.lr_date) as last_lr_date from lrs l
              where l.company_id = p.company_id and l.cancelled_at is null
                and p.id in (l.consignor_id, l.consignee_id, l.billed_to_id)) s on true`
      : tx` from parties p`;
    // Both statements go out together on the one connection: one round trip.
    const [rows, [{ n }]] = await Promise.all([
      tx`select p.* ${statsJoin} where ${where()}
          order by lower(p.name), p.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from parties p where ${where()}`,
    ]);
    return {
      rows: rows.map((r) =>
        stats
          ? {
              ...toParty(r),
              lrCount: r.lr_count as number,
              lastLrDate: r.last_lr_date as string | null,
              outstandingPaise: 0,
            }
          : toParty(r),
      ) as (S extends true ? Party & PartyStats : Party)[],
      total: n as number,
      page,
      pageSize,
    };
  });
}

export async function listPartyOptions(companyId: string) {
  return withUserRead(async (tx) => {
    const rows = await tx`select id, name, place, is_self from parties
                           where company_id = ${companyId} and cancelled_at is null
                           order by lower(name), id`;
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      place: r.place as string | null,
      isSelf: r.is_self as boolean,
    }));
  });
}

export async function getPartyById(companyId: string, id: string): Promise<Party | null> {
  return withUserRead(async (tx) => {
    const [r] = await tx`select * from parties where company_id = ${companyId} and id = ${id}`;
    return r ? toParty(r) : null;
  });
}

export async function findPartyByGstin(companyId: string, gstin: string): Promise<Party | null> {
  const g = normaliseGstin(gstin);
  return withUserRead(async (tx) => {
    const [r] = await tx`select * from parties
                          where company_id = ${companyId} and gstin = ${g} and cancelled_at is null`;
    return r ? toParty(r) : null;
  });
}

/** `party` is the fully built record from ../parties.ts (id, defaults, rules already applied). */
export async function insertParty(party: Party): Promise<Party> {
  return withUser(async (tx) => {
    const r = await insertRow(
      tx,
      "parties",
      {
        id: party.id,
        company_id: party.companyId,
        ...columns(party, PARTY_COLUMNS),
        is_self: false,
      },
      { checks: party.gstin ? [gstinCheck(tx, party.companyId, party.gstin)] : [] },
    );
    const saved = toParty(r);
    audit(tx, party.companyId, "parties", saved.id, "create", null, saved);
    return saved;
  });
}

export async function updateParty(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<Party>,
): Promise<Party> {
  return withUser(async (tx) => {
    // The GSTIN after the save: the patched one, else the current one.
    const gstin = "gstin" in patch ? (patch.gstin ?? null) : tx`(select gstin from cur)`;
    const { before, after } = await saveRow(
      tx,
      "parties",
      companyId,
      id,
      expectedVersion,
      columns(patch, PARTY_COLUMNS),
      {
        what: "Party",
        guard: tx`not cur.is_self`,
        checks: gstin === null ? [] : [gstinCheck(tx, companyId, gstin, id)],
        validate: (row) => {
          const current = toParty(row);
          if (current.isSelf) fail("", SELF_PARTY_LOCKED);
          assertRules(partyRuleErrors({ ...current, ...patch }));
        },
      },
    );
    const saved = toParty(after);
    audit(tx, companyId, "parties", id, "update", toParty(before), saved);
    return saved;
  });
}

export async function getPartyUsage(companyId: string, id: string): Promise<PartyUsage> {
  return withUserRead(async (tx) => {
    const [r] = await tx`
      select
        (select count(*) from lrs l where l.company_id = ${companyId} and l.cancelled_at is null
            and ${id} in (l.consignor_id, l.consignee_id, l.billed_to_id)) as lrs,
        (select count(*) from tax_invoices t where t.company_id = ${companyId} and t.cancelled_at is null
            and ${id} in (t.seller_party_id, t.bill_to_id, t.ship_to_id)) as invoices,
        (select count(*) from lrs l where l.company_id = ${companyId} and l.cancelled_at is null
            and l.consignor_id = ${id}) as as_consignor,
        (select count(*) from lrs l where l.company_id = ${companyId} and l.cancelled_at is null
            and l.consignee_id = ${id}) as as_consignee,
        (select count(*) from lrs l where l.company_id = ${companyId} and l.cancelled_at is null
            and l.billed_to_id = ${id}) as as_billed_to`;
    return {
      lrs: r.lrs,
      invoices: r.invoices,
      asConsignor: r.as_consignor,
      asConsignee: r.as_consignee,
      asBilledTo: r.as_billed_to,
    };
  });
}

/** Comma-separated uuids → uuid[] in SQL (avoids driver array typing with prepare: false). */
export const uuidList = (ids: string[]) => ids.join(",");

export async function getPartyStats(
  companyId: string,
  ids: string[],
): Promise<Record<string, PartyStats>> {
  if (ids.length === 0) return {};
  return withUserRead(async (tx) => {
    const rows = await tx`
      select p.id, count(l.id) as lr_count, max(l.lr_date) as last_lr_date
        from unnest(string_to_array(${uuidList(ids)}, ',')::uuid[]) as p(id)
        left join lrs l on l.company_id = ${companyId} and l.cancelled_at is null
                       and p.id in (l.consignor_id, l.consignee_id, l.billed_to_id)
       group by p.id`;
    return Object.fromEntries(
      rows.map((r) => [
        r.id as string,
        {
          lrCount: r.lr_count as number,
          lastLrDate: r.last_lr_date as string | null,
          outstandingPaise: 0,
        },
      ]),
    );
  });
}

export async function listShipsTo(companyId: string, consignorId: string): Promise<ShipsTo[]> {
  return withUserRead(async (tx) => {
    const rows = await tx`
      select l.consignee_id, l.billed_to_id, l.to_place, l.booked_at,
             c.name, c.place, c.source, b.name as billed_to_name
        from lrs l
        join parties c on c.company_id = l.company_id and c.id = l.consignee_id
        left join parties b on b.company_id = l.company_id and b.id = l.billed_to_id
       where l.company_id = ${companyId} and l.cancelled_at is null and l.consignor_id = ${consignorId}
       order by l.created_at desc`;
    const byConsignee = new Map<string, ShipsTo>();
    for (const r of rows as Row[]) {
      const row = byConsignee.get(r.consignee_id) ?? {
        consigneeId: r.consignee_id,
        name: r.name,
        place: r.place,
        billedToName: r.billed_to_id && r.billed_to_id !== r.consignee_id ? r.billed_to_name : null,
        toPlace: r.to_place,
        fromInvoiceScan: r.source === "invoice_scan",
        lrCount: 0,
        draftCount: 0,
      };
      if (r.booked_at) row.lrCount += 1;
      else row.draftCount += 1;
      byConsignee.set(r.consignee_id, row);
    }
    return [...byConsignee.values()];
  });
}

/** Cancel after ../parties.ts checked the self-party and usage rules. */
export async function cancelPartyRow(
  companyId: string,
  id: string,
  reason?: string,
): Promise<Party> {
  return withUser(async (tx) => {
    const { before, after, changed } = await cancelRow(
      tx,
      "parties",
      companyId,
      id,
      "Party",
      reason,
    );
    const saved = toParty(after);
    if (changed) audit(tx, companyId, "parties", id, "cancel", toParty(before), saved);
    return saved;
  });
}

export async function getSelfParty(companyId: string): Promise<Party> {
  return withUserRead(async (tx) => {
    const [r] = await tx`select * from parties where company_id = ${companyId} and is_self`;
    if (!r) throw new NotFoundError("Company");
    return toParty(r);
  });
}
