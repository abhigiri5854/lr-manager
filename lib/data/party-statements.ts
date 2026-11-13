// Truck-owner statement links: a truck party's read-only statement on WhatsApp (no login). Database only,
// like driver links: under unit tests the owner-side writes stop after their permission check.
//
// Owner side (signed in): master.edit to create / revoke (each audited), freight.view to see the status.
//   getOrCreatePartyStatementLink → full URL <APP_BASE_URL>/s/<token> (same URL on every resend)
//   revokePartyStatementLink, getPartyStatementLinkStatus
// Token side (SESSION-LESS — no assertCan, no cookie): the token is the credential. partyStatement checks
// the token's shape (malformed → DriverLinkError), rate-limits it (60 / min per link, per server instance)
// and sends only its SHA-256 to app.party_statement, which returns null for a missing / revoked / expired
// link and never returns party freight, consignor / consignee freight or margin.
import { createRateLimiter, DriverLinkError, driverLinkKey, hashToken, isTokenShape, TooManyRequestsError } from "@/lib/driver-link";
import { fail } from "./_store";
import * as dbs from "./db/party-statements";
import type { PartyStatement, PartyStatementLinkStatus, PartyStatementLinkView } from "./db/party-statements";
import { appBaseUrl } from "./driver-links";
import { assertCan } from "./session";
import { onDatabase } from "./source";

export { DriverLinkError, TooManyRequestsError };
export type { PartyStatement, PartyStatementLinkStatus, PartyStatementLinkView };

const DB_ONLY = "Statement links need the database";

// ---------- owner side ----------
/** The party's link to send on WhatsApp: the same URL every time, or a new one if none / expired. */
export async function getOrCreatePartyStatementLink(
  companyId: string,
  partyId: string,
): Promise<PartyStatementLinkView> {
  await assertCan(companyId, "master.edit");
  if (!onDatabase()) fail("", DB_ONLY);
  driverLinkKey(); // fail closed before touching the database
  return dbs.getOrCreatePartyStatementLink(companyId, partyId, appBaseUrl());
}

/** Stops the party's link at once. A new one can be made afterwards (different URL). */
export async function revokePartyStatementLink(companyId: string, partyId: string): Promise<{ revoked: boolean }> {
  await assertCan(companyId, "master.edit");
  if (!onDatabase()) fail("", DB_ONLY);
  return dbs.revokePartyStatementLink(companyId, partyId);
}

/** Is the party's link live, when it was made and last opened (freight.view). Null = never had one. */
export async function getPartyStatementLinkStatus(
  companyId: string,
  partyId: string,
): Promise<PartyStatementLinkStatus | null> {
  await assertCan(companyId, "freight.view");
  return onDatabase() ? dbs.getPartyStatementLinkStatus(companyId, partyId) : null;
}

// ---------- token side (session-less) ----------
const limiter = createRateLimiter(60, 60_000);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The current Indian financial year (1 Apr – 31 Mar) as ISO dates. */
function currentFy(now = new Date()): { from: string; to: string } {
  const ist = new Date(now.getTime() + 330 * 60_000); // India date via shifted UTC fields
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

function validDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Session-less. The party's statement for from..to (ISO dates, default: the current financial year);
 * null when the link is missing, revoked or expired. A malformed token throws DriverLinkError.
 */
export async function partyStatement(token: string, from?: string | null, to?: string | null): Promise<PartyStatement | null> {
  const fy = currentFy();
  const f = from || fy.from;
  const t = to || fy.to;
  if (!validDate(f)) fail("from", "From date must be a valid date");
  if (!validDate(t)) fail("to", "To date must be a valid date");
  if (f > t) fail("from", "From date can't be after To date");
  if (!isTokenShape(token)) throw new DriverLinkError();
  const hash = hashToken(token);
  if (!limiter.take(hash)) throw new TooManyRequestsError();
  if (!onDatabase()) return null;
  return dbs.partyStatementByHash(hash, f, t);
}
