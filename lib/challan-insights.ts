// Pure helpers behind the challan form's right rail: trip margin, lane-rate outlier, warnings.
// The data comes from lib/data/challans.getChallanInsights; nothing here touches the database.

export type ChallanInsightQuery = {
  vehicleId: string | null;
  driverId: string | null;
  brokerId: string | null;
  payeeKind: "owner" | "broker";
  source: string;
  destination: string;
  rateBasis: "trip" | "per_tonne";
  lrIds: string[];
};

export type ChallanInsights = {
  settings: {
    minMarginPct: number | null;
    rateOutlierPct: number | null;
    ewbAlertHours: number | null;
  };
  /** Last hires on the same source → destination, vehicle type and rate basis (newest first). */
  lane: { n: number; medianRate: string; rates: string[] } | null;
  vehicle: {
    vehicleNo: string;
    insuranceUpto: string | null;
    fitnessUpto: string | null;
    permitUpto: string | null;
  } | null;
  driver: { name: string; dlUpto: string | null } | null;
  payee: { name: string; verified: boolean; blacklisted: boolean } | null;
  /** Earliest e-way bill expiry (ISO timestamp) of each LR that has one. */
  ewb: { lrNo: string; expiresAt: string }[];
};

/** Party freight vs gross hire (all paise). `pct` is null when there is no freight to compare. */
export function tripMargin(
  freightPaise: number,
  grossHirePaise: number,
  minMarginPct: number | null,
): { marginPaise: number; pct: number | null; low: boolean } {
  const marginPaise = freightPaise - grossHirePaise;
  const pct = freightPaise > 0 ? (marginPaise / freightPaise) * 100 : null;
  const low = minMarginPct !== null && (pct === null ? grossHirePaise > 0 : pct < minMarginPct);
  return { marginPaise, pct, low };
}

/** Amber when `rate` is more than `outlierPct` % above the lane median. */
export function rateOutlier(
  rate: number,
  medianRate: number,
  outlierPct: number | null,
): { abovePct: number; outlier: boolean } | null {
  if (!(rate > 0) || !(medianRate > 0)) return null;
  const abovePct = ((rate - medianRate) / medianRate) * 100;
  return { abovePct, outlier: outlierPct !== null && abovePct > outlierPct };
}

const ddmmyyyy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("-");

/** Non-blocking warnings. `today` is yyyy-mm-dd (IST); `nowMs` is the current time for e-way bills. */
export function challanWarnings(i: ChallanInsights | null, today: string, nowMs: number): string[] {
  if (!i) return [];
  const out: string[] = [];
  if (i.payee?.blacklisted) out.push(`${i.payee.name} is blacklisted — do not pay.`);
  else if (i.payee && !i.payee.verified) out.push(`${i.payee.name} is not verified yet.`);
  const expiry = (label: string, date: string | null) => {
    if (date && date < today) out.push(`${label} expired on ${ddmmyyyy(date)}.`);
  };
  if (i.vehicle) {
    expiry(`${i.vehicle.vehicleNo}: insurance`, i.vehicle.insuranceUpto);
    expiry(`${i.vehicle.vehicleNo}: fitness`, i.vehicle.fitnessUpto);
    expiry(`${i.vehicle.vehicleNo}: permit`, i.vehicle.permitUpto);
  }
  if (i.driver) expiry(`${i.driver.name}: driving licence`, i.driver.dlUpto);
  const alertHours = i.settings.ewbAlertHours;
  if (alertHours !== null) {
    for (const e of i.ewb) {
      const left = new Date(e.expiresAt).getTime() - nowMs;
      if (left <= 0) out.push(`LR ${e.lrNo}: e-way bill expired.`);
      else if (left <= alertHours * 3_600_000)
        out.push(`LR ${e.lrNo}: e-way bill expires in ${Math.max(1, Math.round(left / 3_600_000))} h.`);
    }
  }
  return out;
}
