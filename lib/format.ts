const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 18490258 → "1,84,902.58" */
export function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

/** 18490258 → "₹1,84,902.58"; negatives as "-₹500.00". */
export function formatRupees(paise: number): string {
  return paise < 0 ? `-₹${formatPaise(-paise)}` : `₹${formatPaise(paise)}`;
}

/** "2026-10-14" or a full ISO timestamp → "14-10-2026" (UTC date). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0–99 → "Eighty-Four" */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

/** 0–999 → "Nine Hundred Two" (empty for 0) */
function threeDigits(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
  if (n % 100) parts.push(twoDigits(n % 100));
  return parts.join(" ");
}

/** Whole number in the Indian system (crore, lakh, thousand). */
function integerInWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${integerInWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/**
 * 18490258 → "Rupees One Lakh Eighty-Four Thousand Nine Hundred Two and Fifty-Eight Paise only"
 */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new RangeError("amountInWords needs a non-negative whole number of paise");
  }
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  const paisePart = p ? ` and ${twoDigits(p)} Paise` : "";
  return `Rupees ${integerInWords(rupees)}${paisePart} only`;
}
