// Truck-owner statement links on the database (0024_party_statement_links.sql). Data layer only.
//
// Owner side (signed in, RLS: master.edit for share_links; freight.view for the status function):
// withUser / withUserRead, audit rows sent with the commit. The token is never audited.
// Token side (no session): asService + app.party_statement, which takes the token HASH and returns null
// when the link is missing / revoked / expired. Never returns party freight, consignor / consignee
// freight or margin.
import { decryptToken, driverLinkKey, encryptToken, hashToken, newToken } from "@/lib/driver-link";
import { fail } from "../_store";
import { NotFoundError } from "../errors";
import { asService, withUser, withUserRead } from "./conn";
import { audit, type Row } from "./rows";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

/** Days a new statement link stays valid (share_links.expires_at is NOT NULL). */
const LINK_DAYS = 365;

export interface PartyStatementLinkView {
  partyId: string;
  url: string;
  createdAt: string;
  lastOpenedAt: string | null;
  expiresAt: string | null;
}

export interface PartyStatementLinkStatus {
  status: "active" | "revoked" | "expired";
  createdAt: string;
  lastOpenedAt: string | null;
  expiresAt: string | null;
}

/** Money fields are strings with 2 decimals (rupees). */
export interface PartyStatementChallan {
  challanNo: string;
  date: string;
  vehicleNo: string | null;
  source: string | null;
  destination: string | null;
  hire: string;
  additions: string;
  deductions: string;
  tds: string;
  paid: string;
  balance: string;
  status: string;
  podReceivedOn: string | null;
}

export interface PartyStatementPayment {
  voucherNo: string;
  date: string;
  mode: string;
  reference: string | null;
  gross: string;
  tds: string;
  net: string;
  challans: string[];
}

export interface PartyStatement {
  partyName: string;
  companyName: string;
  officePhone: string | null;
  from: string;
  to: string;
  challans: PartyStatementChallan[];
  payments: PartyStatementPayment[];
  /** The period's challans. */
  totals: { hire: string; additions: string; deductions: string; tds: string; paid: string; balance: string };
  /** Balance outstanding over ALL time (not just the period). */
  balanceOutstanding: string;
}

const linkUrl = (base: string, token: string) => `${base}/s/${token}`;

// ---------- owner side ----------
/**
 * The party's live link (same URL every time), or a new one when there is none or it expired (the
 * expired one is revoked first, so there is never more than one active link).
 */
export async function getOrCreatePartyStatementLink(
  companyId: string,
  partyId: string,
  baseUrl: string,
): Promise<PartyStatementLinkView> {
  if (!UUID.test(partyId)) throw new NotFoundError("Party");
  const key = driverLinkKey();
  return withUser(async (tx) => {
    // The party row lock serialises two "send link" clicks.
    const [p] = await tx`
      select p.id, p.cancelled_at, l.id as link_id, l.token_hash, l.token_enc, l.expires_at,
             l.created_at as link_created_at, l.last_opened_at,
             (l.expires_at <= now()) as expired
        from truck_parties p
        left join share_links l
          on l.company_id = p.company_id and l.party_id = p.id and l.revoked_at is null
       where p.company_id = ${companyId} and p.id = ${partyId}
       for update of p`;
    if (!p) throw new NotFoundError("Party");
    if (p.cancelled_at) fail("", "This party is cancelled");
    if (p.link_id && !p.expired) {
      return {
        partyId,
        url: linkUrl(baseUrl, decryptToken(p.token_enc, p.token_hash, key)),
        createdAt: iso(p.link_created_at)!,
        lastOpenedAt: iso(p.last_opened_at),
        expiresAt: iso(p.expires_at),
      };
    }

    const token = newToken();
    const revoke = p.link_id
      ? tx`update share_links set revoked_at = now()
            where company_id = ${companyId} and id = ${p.link_id} and revoked_at is null
            returning revoked_at`.execute()
      : null;
    const insert = tx`
      insert into share_links (company_id, party_id, token_hash, token_enc, expires_at, created_by)
      values (${companyId}, ${partyId}, ${hashToken(token)}, ${encryptToken(token, key)},
              now() + make_interval(days => ${LINK_DAYS}::int), auth.uid())
      returning id, created_at, last_opened_at, expires_at`.execute();
    const [revoked, [row]] = await Promise.all([revoke, insert]);
    if (p.link_id && revoked?.[0])
      audit(tx, companyId, "share_links", p.link_id, "update", { revokedAt: null }, {
        revokedAt: iso(revoked[0].revoked_at),
        reason: "Expired; new link made",
      });
    audit(tx, companyId, "share_links", row.id, "create", null, {
      partyId,
      expiresAt: iso(row.expires_at),
    });
    return {
      partyId,
      url: linkUrl(baseUrl, token),
      createdAt: iso(row.created_at)!,
      lastOpenedAt: null,
      expiresAt: iso(row.expires_at),
    };
  });
}

/** Revokes the party's live link (the old URL stops working at once). False when there was none. */
export async function revokePartyStatementLink(
  companyId: string,
  partyId: string,
): Promise<{ revoked: boolean }> {
  if (!UUID.test(partyId)) throw new NotFoundError("Party");
  return withUser(async (tx) => {
    const rows = await tx`
      update share_links set revoked_at = now()
       where company_id = ${companyId} and party_id = ${partyId} and revoked_at is null
       returning id, revoked_at`;
    for (const r of rows)
      audit(tx, companyId, "share_links", r.id, "update", { revokedAt: null }, { revokedAt: iso(r.revoked_at) });
    return { revoked: rows.length > 0 };
  });
}

/** Active / revoked / expired, made and last opened, for the party's newest link; null = never had one. */
export async function getPartyStatementLinkStatus(
  companyId: string,
  partyId: string,
): Promise<PartyStatementLinkStatus | null> {
  if (!UUID.test(partyId)) throw new NotFoundError("Party");
  return withUserRead(async (tx) => {
    const [r] = await tx`select app.party_statement_link_status(${companyId}::uuid, ${partyId}::uuid) as s`;
    const s = r?.s as Row | null | undefined;
    if (!s) return null;
    return {
      status: s.status as PartyStatementLinkStatus["status"],
      createdAt: iso(s.createdAt)!,
      lastOpenedAt: iso(s.lastOpenedAt),
      expiresAt: iso(s.expiresAt),
    };
  });
}

// ---------- token side (no session; the caller passes the token's hash) ----------
/** The statement for the period; null when the link is missing / revoked / expired. Stamps last_opened_at. */
export async function partyStatementByHash(hash: string, from: string, to: string): Promise<PartyStatement | null> {
  return asService(async (tx) => {
    const [r] = await tx`select app.party_statement(${hash}, ${from}::date, ${to}::date) as s`;
    const s = r?.s as Row | null | undefined;
    if (!s) return null;
    const h = s.header as Row;
    return {
      partyName: h.partyName,
      companyName: h.companyName,
      officePhone: h.officePhone ?? null,
      from: s.from,
      to: s.to,
      challans: ((s.challans as Row[]) ?? []).map((c) => ({
        challanNo: c.challanNo,
        date: c.date,
        vehicleNo: c.vehicleNo ?? null,
        source: c.source ?? null,
        destination: c.destination ?? null,
        hire: c.hire,
        additions: c.additions,
        deductions: c.deductions,
        tds: c.tds,
        paid: c.paid,
        balance: c.balance,
        status: c.status,
        podReceivedOn: c.podReceivedOn ?? null,
      })),
      payments: ((s.payments as Row[]) ?? []).map((p) => ({
        voucherNo: p.voucherNo,
        date: p.date,
        mode: p.mode,
        reference: p.reference ?? null,
        gross: p.gross,
        tds: p.tds,
        net: p.net,
        challans: (p.challans as string[]) ?? [],
      })),
      totals: s.totals as PartyStatement["totals"],
      balanceOutstanding: s.balanceOutstanding as string,
    };
  });
}
