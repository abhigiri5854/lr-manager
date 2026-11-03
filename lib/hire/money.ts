// Money helpers for hire calcs. DB stores numeric(14,2) rupees (Drizzle gives strings);
// calcs run in integer paise so sums never pick up float error.

export type Money = string | number;

/** "1234.5" | 1234.5 → 123450 paise. Rounds half away from zero past 2 decimals. */
export function toPaise(value: Money | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const text = typeof value === "number" ? value.toFixed(6) : value.trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) {
    throw new Error(`Invalid amount: ${String(value)}`);
  }
  const [, sign, whole, frac = ""] = match;
  const padded = (frac + "000").slice(0, 3);
  let paise = Number(whole || "0") * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) paise += 1;
  return sign && paise !== 0 ? -paise : paise;
}

/** 123450 → "1234.50" (numeric(14,2) format). */
export function fromPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Decimal string/number → integer thousandths (tonnes to 3 dp, percent to 3 dp). */
export function toMilli(value: Money | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const text = typeof value === "number" ? value.toFixed(6) : value.trim();
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[1] === "" && (match[2] ?? "") === "")) {
    throw new Error(`Invalid quantity: ${String(value)}`);
  }
  const [, whole, frac = ""] = match;
  const padded = (frac + "0000").slice(0, 4);
  let milli = Number(whole || "0") * 1000 + Number(padded.slice(0, 3));
  if (Number(padded[3]) >= 5) milli += 1;
  return milli;
}

/** paise × milli / 1000, rounded half up, exact for numeric(14,2) ranges. */
export function mulMilli(paise: number, milli: number): number {
  const product = BigInt(paise) * BigInt(milli);
  const neg = product < 0n;
  const abs = neg ? -product : product;
  const rounded = (abs + 500n) / 1000n;
  return Number(neg ? -rounded : rounded);
}
