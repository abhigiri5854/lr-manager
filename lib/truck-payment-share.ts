// WhatsApp share text for a payment voucher (voucher no, challans, net paid, reference).
import { formatPaise } from "@/lib/format";
import { toPaise } from "@/lib/hire";
import type { TruckPayment } from "@/lib/types";

const MODE = { bank: "Bank transfer", upi: "UPI", cash: "Cash", cheque: "Cheque", diesel: "Diesel" } as const;

export function paymentShareText(p: TruckPayment, companyName?: string | null): string {
  const lines = [
    companyName ? `${companyName} — payment voucher` : "Payment voucher",
    `Voucher: ${p.paymentNo ?? "(not approved yet)"}`,
    p.payeeName ? `Paid to: ${p.payeeName}` : null,
    `Challans: ${[...new Set(p.allocations.map((a) => a.challanNo))].join(", ") || "—"}`,
    `Net paid: ₹${formatPaise(toPaise(p.amount))}`,
    toPaise(p.tdsAmount) > 0 ? `TDS deducted: ₹${formatPaise(toPaise(p.tdsAmount))}` : null,
    `Mode: ${MODE[p.mode]}${p.refNo ? ` · Ref: ${p.refNo}` : ""}`,
  ];
  return lines.filter((l): l is string => !!l).join("\n");
}

/** wa.me link; with the payee's mobile (10 digits → +91) it opens their chat, else a contact picker. */
export function whatsappLink(text: string, mobile?: string | null): string {
  const digits = (mobile ?? "").replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits.length >= 11 ? digits : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
