// GST reference data: state / UT codes and the allowed goods rates. Not company-specific.

/** GST state / UT codes (first two characters of a GSTIN). */
export const GST_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "25", name: "Daman and Diu" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "28", name: "Andhra Pradesh (old)" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
  { code: "99", name: "Centre Jurisdiction" },
];

/** "10" → "Bihar"; unknown → the code itself. */
export function stateName(code: string | null | undefined): string {
  if (!code) return "";
  return GST_STATES.find((s) => s.code === code)?.name ?? code;
}

/** "10" → "Bihar (10)" */
export function stateLabel(code: string): string {
  return `${stateName(code)} (${code})`;
}

/** Allowed goods GST rates in basis points: 0, 0.25, 3, 5, 12, 18, 28, 40 %. */
export const GST_RATES_BP = [0, 25, 300, 500, 1200, 1800, 2800, 4000] as const;

export function isGstRateBp(bp: number): boolean {
  return (GST_RATES_BP as readonly number[]).includes(bp);
}

/** 1800 → "18%", 25 → "0.25%" */
export function formatGstRate(bp: number): string {
  return `${bp / 100}%`;
}

/** Invoices above this value need an e-way bill (₹50,000). */
export const EWAY_BILL_THRESHOLD_PAISE = 5_000_000;

/** A party's GST state: its saved state, else the first two characters of its GSTIN. */
export function partyState(
  p: { stateCode: string | null; gstin: string | null } | null | undefined,
): string | null {
  return p?.stateCode ?? p?.gstin?.slice(0, 2) ?? null;
}
