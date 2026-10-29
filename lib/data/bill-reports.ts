// Bills & payments screens: KPIs, dues by party and the party ledger. Pure — both data sources
// (mock store, Postgres) fetch the same plain facts and these functions turn them into numbers.
import { daysBetween, financialYear } from "@/lib/fy";
import type { Paise } from "@/lib/types";

/** A final, live bill. `receivedPaise` = everything allocated to it (TDS included). */
export type BillFact = {
  id: string;
  partyId: string;
  billNo: string | null;
  billDate: string;
  amountPaise: Paise;
  receivedPaise: Paise;
};

/** A live payment. `allocatedPaise` = the part of amount + TDS that settles bills. */
export type PaymentFact = {
  id: string;
  partyId: string;
  receivedOn: string;
  amountPaise: Paise;
  tdsPaise: Paise;
  allocatedPaise: Paise;
  mode: "neft_upi" | "cheque" | "cash";
  reference: string | null;
};

export type BillFacts = {
  bills: BillFact[];
  payments: PaymentFact[];
  /** Booked TBB LRs on no live bill, counted per billing party. */
  unbilledTbbByParty: { partyId: string; count: number }[];
  parties: { id: string; name: string; place: string | null }[];
};

export type BillsOverview = {
  unbilledTbbLrs: number;
  billsThisFy: number;
  /** Payments received this FY, TDS included. */
  receivedPaise: Paise;
  outstandingPaise: Paise;
  ageing: { d0to30: Paise; d31to60: Paise; d60plus: Paise };
};

const due = (b: BillFact) => Math.max(0, b.amountPaise - b.receivedPaise);

export function buildBillsOverview(f: BillFacts, today: string): BillsOverview {
  const fy = financialYear(today);
  const ageing = { d0to30: 0, d31to60: 0, d60plus: 0 };
  let outstanding = 0;
  for (const b of f.bills) {
    const d = due(b);
    if (!d) continue;
    outstanding += d;
    const age = daysBetween(b.billDate, today);
    if (age <= 30) ageing.d0to30 += d;
    else if (age <= 60) ageing.d31to60 += d;
    else ageing.d60plus += d;
  }
  return {
    unbilledTbbLrs: f.unbilledTbbByParty.reduce((s, x) => s + x.count, 0),
    billsThisFy: f.bills.filter((b) => financialYear(b.billDate) === fy).length,
    receivedPaise: f.payments
      .filter((p) => financialYear(p.receivedOn) === fy)
      .reduce((s, p) => s + p.amountPaise + p.tdsPaise, 0),
    outstandingPaise: outstanding,
    ageing,
  };
}

export type PartyDues = {
  partyId: string;
  name: string;
  place: string | null;
  unbilledLrs: number;
  billedPaise: Paise;
  /** Cash received (without TDS). */
  receivedPaise: Paise;
  tdsPaise: Paise;
  /** What is still due on bills. */
  outstandingPaise: Paise;
  /** Received (+ TDS) not yet allocated to a bill. */
  onAccountPaise: Paise;
  oldestDueDate: string | null;
};

/** One row per party that has a bill, a payment or an unbilled TBB LR; biggest dues first. */
export function buildPartyDues(f: BillFacts): PartyDues[] {
  const rows = new Map<string, PartyDues>();
  const get = (partyId: string) => {
    let r = rows.get(partyId);
    if (!r) {
      const p = f.parties.find((x) => x.id === partyId);
      r = {
        partyId,
        name: p?.name ?? "",
        place: p?.place ?? null,
        unbilledLrs: 0,
        billedPaise: 0,
        receivedPaise: 0,
        tdsPaise: 0,
        outstandingPaise: 0,
        onAccountPaise: 0,
        oldestDueDate: null,
      };
      rows.set(partyId, r);
    }
    return r;
  };
  for (const u of f.unbilledTbbByParty) get(u.partyId).unbilledLrs += u.count;
  for (const b of f.bills) {
    const r = get(b.partyId);
    r.billedPaise += b.amountPaise;
    const d = due(b);
    r.outstandingPaise += d;
    if (d && (!r.oldestDueDate || b.billDate < r.oldestDueDate)) r.oldestDueDate = b.billDate;
  }
  for (const p of f.payments) {
    const r = get(p.partyId);
    r.receivedPaise += p.amountPaise;
    r.tdsPaise += p.tdsPaise;
    r.onAccountPaise += p.amountPaise + p.tdsPaise - p.allocatedPaise;
  }
  return [...rows.values()].sort(
    (a, b) => b.outstandingPaise - a.outstandingPaise || a.name.localeCompare(b.name),
  );
}

export type LedgerEntry = {
  key: string;
  date: string;
  kind: "bill" | "payment" | "tds";
  /** Bill no., or the payment's mode and reference. */
  ref: string;
  /** Link target: the bill's id (payments have no page of their own). */
  billId: string | null;
  paymentId: string | null;
  debitPaise: Paise;
  creditPaise: Paise;
  /** Payment rows: the part of amount + TDS not yet allocated to a bill. */
  onAccountPaise: Paise;
  /** Billed minus received so far (TDS counts as received). Negative = party has paid ahead. */
  runningPaise: number;
};

export type PartyLedger = {
  entries: LedgerEntry[];
  billedPaise: Paise;
  receivedPaise: Paise;
  tdsPaise: Paise;
  balancePaise: number;
  onAccountPaise: Paise;
};

const MODE_LABEL = { neft_upi: "NEFT / UPI", cheque: "Cheque", cash: "Cash" } as const;

/** Bills (debit) and payments / TDS (credit) of one party, oldest first, with a running balance. */
export function buildPartyLedger(f: BillFacts, partyId: string): PartyLedger {
  const raw: Omit<LedgerEntry, "runningPaise">[] = [];
  for (const b of f.bills.filter((x) => x.partyId === partyId)) {
    raw.push({
      key: `b:${b.id}`,
      date: b.billDate,
      kind: "bill",
      ref: b.billNo ?? "Bill",
      billId: b.id,
      paymentId: null,
      debitPaise: b.amountPaise,
      creditPaise: 0,
      onAccountPaise: 0,
    });
  }
  for (const p of f.payments.filter((x) => x.partyId === partyId)) {
    const ref = [MODE_LABEL[p.mode], p.reference].filter(Boolean).join(" · ");
    raw.push({
      key: `p:${p.id}`,
      date: p.receivedOn,
      kind: "payment",
      ref,
      billId: null,
      paymentId: p.id,
      debitPaise: 0,
      creditPaise: p.amountPaise,
      onAccountPaise: p.amountPaise + p.tdsPaise - p.allocatedPaise,
    });
    if (p.tdsPaise > 0) {
      raw.push({
        key: `t:${p.id}`,
        date: p.receivedOn,
        kind: "tds",
        ref: `TDS${p.reference ? ` · ${p.reference}` : ""}`,
        billId: null,
        paymentId: p.id,
        debitPaise: 0,
        creditPaise: p.tdsPaise,
        onAccountPaise: 0,
      });
    }
  }
  // Same day: bills first, then receipts, so a same-day payment never shows the party as ahead.
  const order = { bill: 0, payment: 1, tds: 2 } as const;
  raw.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
  let running = 0;
  const entries = raw.map((e) => {
    running += e.debitPaise - e.creditPaise;
    return { ...e, runningPaise: running };
  });
  const mine = f.payments.filter((p) => p.partyId === partyId);
  return {
    entries,
    billedPaise: entries.reduce((s, e) => s + e.debitPaise, 0),
    receivedPaise: mine.reduce((s, p) => s + p.amountPaise, 0),
    tdsPaise: mine.reduce((s, p) => s + p.tdsPaise, 0),
    balancePaise: running,
    onAccountPaise: mine.reduce((s, p) => s + p.amountPaise + p.tdsPaise - p.allocatedPaise, 0),
  };
}
