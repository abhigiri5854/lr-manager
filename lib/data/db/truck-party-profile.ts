// A truck party's profile page: the party, this-FY summary, and its challans / payments (newest first).
// One RLS read; joins and aggregates only, no per-row queries.
import { financialYear, todayInIndia } from "@/lib/fy";
import { toPaise } from "@/lib/hire";
import type { TruckParty } from "@/lib/types";
import { NotFoundError } from "../errors";
import { withUserRead } from "./conn";
import { toTruckParty } from "./rows";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_MAX = 200;

export type TruckPartyProfileChallan = {
  id: string;
  challanNo: string;
  date: string;
  status: string;
  vehicleNo: string | null;
  source: string | null;
  destination: string | null;
  hirePaise: number;
  paidPaise: number;
  balancePaise: number;
};

export type TruckPartyProfilePayment = {
  id: string;
  paymentNo: string | null;
  paidOn: string;
  mode: string;
  status: string;
  netPaise: number;
  tdsPaise: number;
  challanNos: string[];
};

export type TruckPartyProfile = {
  party: TruckParty;
  fy: string;
  tripsThisFy: number;
  balancePaise: number;
  lastPayment: { paidOn: string; amountPaise: number } | null;
  challans: TruckPartyProfileChallan[];
  payments: TruckPartyProfilePayment[];
};

/** null when the party doesn't exist in this company. */
export async function getTruckPartyProfile(companyId: string, partyId: string): Promise<TruckPartyProfile | null> {
  if (!UUID.test(partyId)) throw new NotFoundError("Truck party");
  const today = todayInIndia();
  const fy = financialYear(today);
  const fyStart = `${fy.slice(0, 4)}-04-01`;
  const fyEnd = `${Number(fy.slice(0, 4)) + 1}-03-31`;
  return withUserRead(async (tx) => {
    const [[party], challans, payments, [sum]] = await Promise.all([
      tx`select * from truck_parties where company_id = ${companyId} and id = ${partyId}`,
      tx`select c.id, c.challan_no, (c.challan_at at time zone 'Asia/Kolkata')::date::text as challan_date,
                c.status::text as status, v.vehicle_no, c.source, c.destination,
                c.hire_amount, vb.paid, vb.balance
           from challans c
           join v_challan_balance vb on vb.company_id = c.company_id and vb.challan_id = c.id
           left join market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
          where c.company_id = ${companyId} and c.payee_party_id = ${partyId} and c.cancelled_at is null
          order by c.challan_at desc, c.id desc
          limit ${LIST_MAX}`,
      tx`select t.id, t.payment_no, t.paid_on::text as paid_on, t.mode::text as mode, t.status::text as status,
                t.amount, t.tds_amount, ch.nos as challan_nos
           from truck_payments t
           left join lateral (
             select array_agg(c.challan_no order by c.challan_no) as nos
               from truck_payment_allocations a
               join challans c on c.company_id = a.company_id and c.id = a.challan_id
              where a.company_id = t.company_id and a.payment_id = t.id) ch on true
          where t.company_id = ${companyId} and t.payee_party_id = ${partyId} and t.cancelled_at is null
          order by t.paid_on desc, t.created_at desc, t.id
          limit ${LIST_MAX}`,
      tx`select
           (select count(*)::int from challans c
             where c.company_id = ${companyId} and c.payee_party_id = ${partyId} and c.cancelled_at is null
               and (c.challan_at at time zone 'Asia/Kolkata')::date between ${fyStart}::date and ${fyEnd}::date) as trips,
           (select coalesce(sum(vb.balance), 0)::text from v_challan_balance vb
             where vb.company_id = ${companyId} and vb.payee_party_id = ${partyId}) as balance,
           (select row(t.paid_on::text, t.amount::text) from truck_payments t
             where t.company_id = ${companyId} and t.payee_party_id = ${partyId} and t.cancelled_at is null
               and t.status = 'paid'
             order by t.paid_on desc, t.created_at desc limit 1) as last_payment`,
    ]);
    if (!party) return null;
    // `row(...)` comes back as a "(2026-10-01,5000.00)" string
    const lp = typeof sum.last_payment === "string" ? /^\((.*),(.*)\)$/.exec(sum.last_payment) : null;
    return {
      party: toTruckParty(party),
      fy,
      tripsThisFy: Number(sum.trips),
      balancePaise: toPaise(String(sum.balance)),
      lastPayment: lp ? { paidOn: lp[1].replace(/"/g, ""), amountPaise: toPaise(lp[2].replace(/"/g, "")) } : null,
      challans: challans.map((r) => ({
        id: r.id as string,
        challanNo: r.challan_no as string,
        date: r.challan_date as string,
        status: r.status as string,
        vehicleNo: (r.vehicle_no as string | null) ?? null,
        source: (r.source as string | null) ?? null,
        destination: (r.destination as string | null) ?? null,
        hirePaise: toPaise(String(r.hire_amount)),
        paidPaise: toPaise(String(r.paid)),
        balancePaise: toPaise(String(r.balance)),
      })),
      payments: payments.map((r) => ({
        id: r.id as string,
        paymentNo: (r.payment_no as string | null) ?? null,
        paidOn: r.paid_on as string,
        mode: r.mode as string,
        status: r.status as string,
        netPaise: toPaise(String(r.amount)),
        tdsPaise: toPaise(String(r.tds_amount)),
        challanNos: (r.challan_nos as string[] | null) ?? [],
      })),
    };
  });
}
