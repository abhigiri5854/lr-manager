// E-way register filter: which bills to show by time left.
export const EWB_WHEN = [
  { value: "all", label: "All" },
  { value: "expired", label: "Expired" },
  { value: "6h", label: "Under 6 h" },
  { value: "24h", label: "Under 24 h" },
] as const;
export type EwbWhen = (typeof EWB_WHEN)[number]["value"];

type Raw = URLSearchParams | Record<string, string | string[] | undefined>;

const pick = (raw: Raw, key: string): string | undefined => {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
};

export type EwbListQuery = { when: EwbWhen; page: number };

export function parseEwbListQuery(raw: Raw): EwbListQuery {
  const w = pick(raw, "when");
  const when = EWB_WHEN.find((o) => o.value === w)?.value ?? "all";
  const p = Number(pick(raw, "page"));
  return { when, page: Number.isInteger(p) && p >= 1 ? p : 1 };
}

export const ewbListSearch = (q: Partial<EwbListQuery>): string => {
  const s = new URLSearchParams();
  if (q.when && q.when !== "all") s.set("when", q.when);
  if (q.page && q.page > 1) s.set("page", String(q.page));
  const t = s.toString();
  return t ? `?${t}` : "";
};
