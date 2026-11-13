// E-way checklist reads (T1-11): one row per e-way bill on a live challan, plus open Part-B tasks.
// Source order: challan_lrs.ewb_no / ewb_date / ewb_valid_upto first; when the line has no e-way no.,
// the LR's invoices (eway_bill_no / eway_expires_at). Expiry = entered valid-upto, else computed from
// ewb_date + ewb_distance_km (lib/hire/ewb-expiry), else none.
import { resolveEwbExpiry, type EwbExpirySource } from "@/lib/hire/ewb-expiry";
import { withUserRead, type Tx } from "./conn";

/** On the road or waiting for POD: not draft, settled or cancelled. */
export const EWB_LIVE_STATUSES = ["dispatched", "in_transit", "reached", "pod_received"];

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

export type EwbLine = {
  lineId: string;
  lrId: string;
  lrNo: string;
  challanId: string;
  challanNo: string;
  vehicleNo: string | null;
  source: string | null;
  destination: string | null;
  ewbNo: string;
  /** ISO instant, or null when neither entered nor computable */
  validUpto: string | null;
  expirySource: EwbExpirySource | null;
};

export async function loadEwbLines(tx: Tx, companyId: string): Promise<EwbLine[]> {
  const [[co], rows] = await Promise.all([
    tx`select ewb_km_per_day from companies where id = ${companyId}`,
    tx`
      select x.* from (
        select cl.id as line_id, cl.lr_id, l.lr_no, c.id as challan_id, c.challan_no, v.vehicle_no,
               c.source, c.destination, cl.ewb_no, cl.ewb_date::text as ewb_date,
               cl.ewb_valid_upto as valid_upto, cl.ewb_distance_km as km
          from challan_lrs cl
          join challans c on c.company_id = cl.company_id and c.id = cl.challan_id
          join lrs l on l.company_id = cl.company_id and l.id = cl.lr_id
          left join market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
         where cl.company_id = ${companyId} and cl.transferred_to_challan_id is null
           and cl.ewb_no is not null
           and c.cancelled_at is null and c.status::text = any(${EWB_LIVE_STATUSES}::text[])
        union all
        select cl.id, cl.lr_id, l.lr_no, c.id, c.challan_no, v.vehicle_no, c.source, c.destination,
               i.eway_bill_no, null::text, i.eway_expires_at, null::int
          from challan_lrs cl
          join challans c on c.company_id = cl.company_id and c.id = cl.challan_id
          join lrs l on l.company_id = cl.company_id and l.id = cl.lr_id
          join lr_invoices i on i.company_id = cl.company_id and i.lr_id = cl.lr_id
                            and i.eway_bill_no is not null
          left join market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
         where cl.company_id = ${companyId} and cl.transferred_to_challan_id is null
           and cl.ewb_no is null
           and c.cancelled_at is null and c.status::text = any(${EWB_LIVE_STATUSES}::text[])
      ) x
      order by x.valid_upto nulls last, x.lr_no, x.ewb_no`,
  ]);
  const kmPerDay = Number(co?.ewb_km_per_day ?? 200) || 200;
  return rows.map((r): EwbLine => {
    const resolved = resolveEwbExpiry({
      ewbNo: r.ewb_no as string,
      enteredUpto: iso(r.valid_upto),
      generatedOn: (r.ewb_date as string | null) ?? null,
      distanceKm: r.km === null ? null : Number(r.km),
      kmPerDay,
    });
    return {
      lineId: r.line_id as string,
      lrId: r.lr_id as string,
      lrNo: r.lr_no as string,
      challanId: r.challan_id as string,
      challanNo: r.challan_no as string,
      vehicleNo: (r.vehicle_no as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      destination: (r.destination as string | null) ?? null,
      ewbNo: r.ewb_no as string,
      validUpto: resolved?.validUpto ?? null,
      expirySource: resolved?.source ?? null,
    };
  });
}

export const listEwbLines = (companyId: string): Promise<EwbLine[]> =>
  withUserRead((tx) => loadEwbLines(tx, companyId));

export type EwbTask = {
  id: string;
  challanId: string;
  challanNo: string;
  lrId: string;
  lrNo: string;
  ewbNo: string | null;
  oldVehicleNo: string | null;
  newVehicleNo: string | null;
  note: string | null;
  createdAt: string;
};

/** Open (not done) Part-B tasks, newest first; for one challan or the whole company. */
export async function listOpenEwbTasks(companyId: string, challanId?: string): Promise<EwbTask[]> {
  return withUserRead(async (tx) => {
    const rows = await tx`
      select t.id, t.challan_id, c.challan_no, t.lr_id, l.lr_no, t.ewb_no, ov.vehicle_no as old_no,
             nv.vehicle_no as new_no, t.note, t.created_at
        from ewb_tasks t
        join challans c on c.company_id = t.company_id and c.id = t.challan_id
        join lrs l on l.company_id = t.company_id and l.id = t.lr_id
        left join market_vehicles ov on ov.company_id = t.company_id and ov.id = t.old_vehicle_id
        left join market_vehicles nv on nv.company_id = t.company_id and nv.id = t.new_vehicle_id
       where t.company_id = ${companyId} and t.done_at is null
         ${challanId ? tx`and t.challan_id = ${challanId}::uuid` : tx``}
       order by t.created_at desc, t.id`;
    return rows.map(
      (r): EwbTask => ({
        id: r.id as string,
        challanId: r.challan_id as string,
        challanNo: r.challan_no as string,
        lrId: r.lr_id as string,
        lrNo: r.lr_no as string,
        ewbNo: (r.ewb_no as string | null) ?? null,
        oldVehicleNo: (r.old_no as string | null) ?? null,
        newVehicleNo: (r.new_no as string | null) ?? null,
        note: (r.note as string | null) ?? null,
        createdAt: iso(r.created_at) as string,
      }),
    );
  });
}
