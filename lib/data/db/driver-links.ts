// Driver links on the database (0023_driver_links.sql). Data layer only.
//
// Owner side (signed in, RLS: master.edit for links, office for trip events): withUser / withUserRead,
// one statement per write, audit rows sent with the commit.
// Token side (no session): asService + the app.driver_* functions, which take the token HASH and do
// every check themselves (live link, own challan, not settled) and write their own audit rows
// (actor system, reason "Driver link <id>"). Nothing here returns hire, freight, margin or balance.
import { decryptToken, DriverLinkError, driverLinkKey, encryptToken, hashToken, newToken } from "@/lib/driver-link";
import type {
  ChallanStatus,
  DriverHistory,
  DriverLinkInfo,
  DriverLinkStatus,
  DriverLinkView,
  DriverPodResult,
  DriverTrip,
  DriverTripLr,
  TripEvent,
  TripEventType,
} from "@/lib/types";
import { fail } from "../_store";
import { NotFoundError } from "../errors";
import { asService, withUser, withUserRead } from "./conn";
import { audit, type Row } from "./rows";
import { podUrlFromPath } from "./storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const numStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function toTripEvent(r: Row): TripEvent {
  return {
    id: r.id,
    challanId: r.challan_id ?? r.challanId,
    type: r.type,
    at: iso(r.at)!,
    lat: num(r.lat),
    lng: num(r.lng),
    accuracyM: num(r.accuracy_m ?? r.accuracyM),
    source: r.source,
    driverLinkId: r.driver_link_id ?? r.driverLinkId ?? null,
    createdBy: r.created_by ?? r.createdBy ?? null,
    note: r.note ?? null,
  };
}

const linkUrl = (base: string, token: string) => `${base}/d/${token}`;

// ---------- owner side ----------
/**
 * The driver's live link (same URL every time), or a new one when there is none or it expired (the
 * expired one is revoked first, so there is never more than one active link).
 */
export async function getOrCreateDriverLink(
  companyId: string,
  driverId: string,
  baseUrl: string,
): Promise<DriverLinkView> {
  if (!UUID.test(driverId)) throw new NotFoundError("Driver");
  const key = driverLinkKey();
  return withUser(async (tx) => {
    // The driver row lock serialises two "send link" clicks.
    const [d] = await tx`
      select d.id, d.cancelled_at, l.id as link_id, l.token_hash, l.token_enc, l.expires_at,
             l.created_at as link_created_at, l.last_opened_at,
             (l.expires_at is not null and l.expires_at <= now()) as expired
        from market_drivers d
        left join driver_links l
          on l.company_id = d.company_id and l.market_driver_id = d.id and l.revoked_at is null
       where d.company_id = ${companyId} and d.id = ${driverId}
       for update of d`;
    if (!d) throw new NotFoundError("Driver");
    if (d.cancelled_at) fail("", "This driver is cancelled");
    if (d.link_id && !d.expired) {
      return {
        driverId,
        url: linkUrl(baseUrl, decryptToken(d.token_enc, d.token_hash, key)),
        createdAt: iso(d.link_created_at)!,
        lastOpenedAt: iso(d.last_opened_at),
        expiresAt: iso(d.expires_at),
      };
    }

    const token = newToken();
    const revoke = d.link_id
      ? tx`update driver_links set revoked_at = now()
            where company_id = ${companyId} and id = ${d.link_id} and revoked_at is null
            returning revoked_at`.execute()
      : null;
    const insert = tx`
      insert into driver_links (company_id, market_driver_id, token_hash, token_enc, created_by)
      values (${companyId}, ${driverId}, ${hashToken(token)}, ${encryptToken(token, key)}, auth.uid())
      returning id, created_at, last_opened_at, expires_at`.execute();
    const [revoked, [row]] = await Promise.all([revoke, insert]);
    if (d.link_id && revoked?.[0])
      audit(tx, companyId, "driver_links", d.link_id, "update", { revokedAt: null }, {
        revokedAt: iso(revoked[0].revoked_at),
        reason: "Expired; new link made",
      });
    audit(tx, companyId, "driver_links", row.id, "create", null, {
      driverId,
      expiresAt: iso(row.expires_at),
    });
    return {
      driverId,
      url: linkUrl(baseUrl, token),
      createdAt: iso(row.created_at)!,
      lastOpenedAt: null,
      expiresAt: iso(row.expires_at),
    };
  });
}

/** Revokes the driver's live link (the old URL stops working at once). False when there was none. */
export async function revokeDriverLink(
  companyId: string,
  driverId: string,
): Promise<{ revoked: boolean }> {
  if (!UUID.test(driverId)) throw new NotFoundError("Driver");
  return withUser(async (tx) => {
    const rows = await tx`
      update driver_links set revoked_at = now()
       where company_id = ${companyId} and market_driver_id = ${driverId} and revoked_at is null
       returning id, revoked_at`;
    for (const r of rows)
      audit(tx, companyId, "driver_links", r.id, "update", { revokedAt: null }, { revokedAt: iso(r.revoked_at) });
    return { revoked: rows.length > 0 };
  });
}

/** Live / revoked, last opened and last seen for the driver's newest link; null = never had one. */
export async function getDriverLinkStatus(companyId: string, driverId: string): Promise<DriverLinkStatus | null> {
  if (!UUID.test(driverId)) throw new NotFoundError("Driver");
  return withUserRead(async (tx) => {
    const [r] = await tx`select app.driver_link_status(${companyId}::uuid, ${driverId}::uuid) as s`;
    const s = r?.s as Row | null | undefined;
    if (!s) return null;
    return {
      status: s.status as "active" | "revoked",
      lastOpenedAt: iso(s.lastOpenedAt),
      lastLat: num(s.lastLat),
      lastLng: num(s.lastLng),
      lastAccuracyM: num(s.lastAccuracyM),
      lastLocatedAt: iso(s.lastLocatedAt),
    };
  });
}

export async function listTripEvents(companyId: string, challanId: string): Promise<TripEvent[]> {
  if (!UUID.test(challanId)) return [];
  return withUserRead(async (tx) => {
    const rows = await tx`
      select * from trip_events where company_id = ${companyId} and challan_id = ${challanId}
       order by at, type, source`;
    return rows.map(toTripEvent);
  });
}

/** Office staff mark a milestone (no location). Repeating a type updates its time / note. */
export async function addStaffTripEvent(
  companyId: string,
  challanId: string,
  type: TripEventType,
  note: string | null,
): Promise<TripEvent> {
  if (!UUID.test(challanId)) throw new NotFoundError("Challan");
  return withUser(async (tx) => {
    const rows = await tx`
      with c as (select id from challans
                  where company_id = ${companyId} and id = ${challanId}
                    and cancelled_at is null and status <> 'draft'),
           prev as (select * from trip_events
                     where company_id = ${companyId} and challan_id = ${challanId}
                       and type = ${type}::trip_event_type and source = 'staff'),
           up as (insert into trip_events (company_id, challan_id, type, at, source, created_by, note)
                  select ${companyId}::uuid, c.id, ${type}::trip_event_type, now(),
                         'staff'::trip_event_source, auth.uid(), ${note}::text
                    from c
                  on conflict (company_id, challan_id, type, source) do update
                     set at = excluded.at, note = excluded.note, created_by = excluded.created_by
                  returning *)
      select 'before' as k, prev.* from prev
      union all
      select 'after', up.* from up`;
    const before = rows.find((r) => r.k === "before");
    const after = rows.find((r) => r.k === "after");
    if (!after) throw new NotFoundError("Challan");
    const saved = toTripEvent(after);
    audit(tx, companyId, "trip_events", saved.id, before ? "update" : "create", before ? toTripEvent(before) : null, saved);
    return saved;
  });
}

// ---------- token side (no session; the caller passes the token's hash) ----------
function toDriverTripLr(x: Row): DriverTripLr {
  return {
    lrId: x.lrId,
    lrNo: x.lrNo,
    lrDate: x.lrDate ?? null,
    fromPlace: x.fromPlace ?? null,
    toPlace: x.toPlace ?? null,
    consignor: x.consignor,
    consignee: x.consignee,
    goods: ((x.goods as Row[]) ?? []).map((g) => ({
      description: g.description,
      packages: g.packages,
      weight: numStr(g.weight),
    })),
    packages: x.packages,
    weight: numStr(x.weight),
    ewayBillNo: x.ewayBillNo ?? null,
    ewayExpiresAt: iso(x.ewayExpiresAt),
    deliveredOn: x.deliveredOn ?? null,
    deliveredPkgs: x.deliveredPkgs ?? null,
    podFiles: x.podFiles ?? 0,
    podReceivedAt: iso(x.podReceivedAt),
  };
}

function toDriverTrip(r: Row): DriverTrip {
  return {
    challanId: r.challan_id,
    challanNo: r.challan_no,
    challanDate: r.challan_date,
    vehicleNo: r.vehicle_no ?? null,
    source: r.source ?? null,
    destination: r.destination ?? null,
    status: r.status as ChallanStatus,
    readOnly: !!r.read_only,
    advancePaid: Number(r.advance_paid ?? 0).toFixed(2),
    podStatus: r.pod_status,
    lrs: ((r.lrs as Row[]) ?? []).map(toDriverTripLr),
    events: ((r.events as Row[]) ?? []).map((e) => ({ type: e.type, at: iso(e.at)!, source: e.source })),
  };
}

/** Who the link is for (+ stamps last_opened_at); null when missing / revoked / expired. */
export async function openDriverLinkByHash(hash: string): Promise<DriverLinkInfo | null> {
  return asService(async (tx) => {
    const [r] = await tx`select app.driver_link_open(${hash}) as info`;
    return (r?.info as DriverLinkInfo | null) ?? null;
  });
}

/** Link + trips in one statement (opening the trip list counts as opening the link). */
export async function driverTripsByHash(
  hash: string,
): Promise<{ driver: DriverLinkInfo; trips: DriverTrip[] } | null> {
  return asService(async (tx) => {
    const [r] = await tx`
      select app.driver_link_open(${hash}) as info,
             (select coalesce(jsonb_agg(t order by t.challan_date desc, t.challan_no desc), '[]'::jsonb)
                from app.driver_trips(${hash}) t) as trips`;
    if (!r?.info) return null;
    return { driver: r.info as DriverLinkInfo, trips: (r.trips as Row[]).map(toDriverTrip) };
  });
}

export async function recordDriverEventByHash(
  hash: string,
  v: { challanId: string; type: TripEventType; lat?: number | null; lng?: number | null; accuracyM?: number | null },
): Promise<TripEvent> {
  return asService(async (tx) => {
    const [r] = await tx`
      select app.driver_trip_event(${hash}, ${v.challanId}::uuid, ${v.type}, ${v.lat ?? null}::numeric,
                                   ${v.lng ?? null}::numeric, ${v.accuracyM ?? null}::numeric) as event`;
    if (!r?.event) throw new DriverLinkError("This trip isn't on your link. Call the office.");
    return toTripEvent(r.event);
  });
}

/** Last-seen ping. True = saved; false = ignored (bad / revoked link, or one was saved < 5 minutes ago). */
export async function pingDriverByHash(
  hash: string,
  v: { lat: number; lng: number; accuracyM?: number | null },
): Promise<boolean> {
  return asService(async (tx) => {
    const [r] = await tx`
      select app.driver_ping(${hash}, ${v.lat}::numeric, ${v.lng}::numeric, ${v.accuracyM ?? null}::numeric) as saved`;
    return r?.saved === true;
  });
}

/** One page of the driver's settled / cancelled trips + the month summary; null = bad link. */
export async function driverHistoryByHash(hash: string, before: string | null): Promise<DriverHistory | null> {
  return asService(async (tx) => {
    const [r] = await tx`select app.driver_history(${hash}, ${before}::date) as history`;
    const h = r?.history as Row | null | undefined;
    if (!h) return null;
    return {
      trips: ((h.trips as Row[]) ?? []).map((t) => ({
        challanNo: t.challanNo,
        challanDate: t.challanDate,
        vehicleNo: t.vehicleNo ?? null,
        source: t.source ?? null,
        destination: t.destination ?? null,
        status: t.status as "settled" | "cancelled",
        podDone: !!t.podDone,
      })),
      historyDays: Number(h.historyDays),
      tripsThisMonth: Number(h.tripsThisMonth),
      podsPending: Number(h.podsPending),
    };
  });
}

/** The company folder for the driver's POD file, or null when the challan / LR isn't theirs. */
export async function driverPodTargetByHash(
  hash: string,
  challanId: string,
  lrId: string,
): Promise<string | null> {
  return asService(async (tx) => {
    const [r] = await tx`select app.driver_pod_target(${hash}, ${challanId}::uuid, ${lrId}::uuid) as company_id`;
    return (r?.company_id as string | null) ?? null;
  });
}

export async function attachDriverPodByHash(
  hash: string,
  v: { challanId: string; lrId: string; deliveredOn?: string; packages?: number | null },
  paths: string[],
): Promise<DriverPodResult> {
  return asService(async (tx) => {
    const [r] = await tx`
      select app.driver_pod_attach(${hash}, ${v.challanId}::uuid, ${v.lrId}::uuid,
                                   ${v.deliveredOn ?? null}::date, ${v.packages ?? null}::integer,
                                   ${paths}::text[]) as pod`;
    const p = r?.pod as Row | null;
    if (!p) throw new DriverLinkError("This trip isn't on your link any more. Call the office.");
    return {
      podId: p.podId,
      lrId: p.lrId,
      documentUrls: ((p.documentPaths as string[]) ?? []).map(podUrlFromPath),
      packagesReceived: p.packagesReceived ?? null,
      receivedAt: iso(p.receivedAt),
      deliveredOn: p.deliveredOn,
      challanStatus: p.challanStatus as ChallanStatus,
    };
  });
}
