// Reads everything a PDF needs through lib/data (company-scoped, role-checked by the route) and
// inlines the images. Finalised documents print their stored snapshot of company and parties;
// drafts print the live records. Nothing about a company lives in the templates.
import { getCompany } from "@/lib/data/companies";
import { getFreightBillById } from "@/lib/data/bills";
import {
  getObject,
  pathFromUrl,
  podPathFromUrl,
  type CompanyBucket,
} from "@/lib/data/db/storage";
import { getTaxInvoiceById, listLrsForInvoice } from "@/lib/data/invoices";
import { getLrById } from "@/lib/data/lrs";
import { getPartyById } from "@/lib/data/parties";
import { getPodById } from "@/lib/data/pod";
import { getTruckById } from "@/lib/data/trucks";
import { companySnapshot } from "@/lib/snapshots";
import type {
  CompanySnapshot,
  FreightBillView,
  LrView,
  PartySnapshot,
  Pod,
  TaxInvoice,
} from "@/lib/types";
import type { PdfCompany, PdfMark } from "./types";

// ---------- images ----------

/** Largest image we inline (logos are capped at 2 MB, POD photos at 3 MB when uploaded). */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

async function toDataUri(
  read: () => ReturnType<typeof getObject>,
): Promise<string | null> {
  try {
    const file = await read();
    if (!file || !file.type.startsWith("image/") || file.bytes.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    return `data:${file.type};base64,${Buffer.from(file.bytes).toString("base64")}`;
  } catch {
    // A missing or unreadable image must never stop the document from printing.
    return null;
  }
}

/** A logo / signature stored by the company profile (an "/uploads/…" link), as a data: URI. */
async function companyImage(
  bucket: CompanyBucket,
  companyId: string,
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return null;
 const path = pathFromUrl(bucket, companyId, url);
if (!path) return null;
return toDataUri(async () => getObject(bucket, path));
}

// ---------- company ----------

/** The company as printed: the snapshot stored on the document, else the live profile. */
export async function loadPdfCompany(
  companyId: string,
  snapshot?: CompanySnapshot | null,
): Promise<PdfCompany | null> {
  let base = snapshot;
  if (!base) {
    const live = await getCompany(companyId);
    if (!live) return null;
    base = companySnapshot(live);
  }
  const [logoSrc, signatureSrc] = await Promise.all([
    companyImage("logos", companyId, base.logoUrl),
    companyImage("signatures", companyId, base.signatureUrl),
  ]);
  return { ...base, logoSrc, signatureSrc };
}

/** A party as stored on the document, else the live record. */
async function partyOf(
  companyId: string,
  snap: PartySnapshot | null | undefined,
  id: string | null | undefined,
): Promise<PartySnapshot | null> {
  if (snap) return snap;
  return id ? await getPartyById(companyId, id) : null;
}

const markOf = (d: { cancelledAt?: string }, isDraft: boolean): PdfMark =>
  d.cancelledAt ? "CANCELLED" : isDraft ? "DRAFT" : null;

// ---------- LR ----------

export type LrPdfData = {
  lr: LrView;
  company: PdfCompany;
  consignor: PartySnapshot | null;
  consignee: PartySnapshot | null;
  /** Null = no billed-to party, so the consignee pays. */
  billedTo: PartySnapshot | null;
  mark: PdfMark;
};

/** The LR with its parties and company, as printed on the four copies. */
async function lrParts(companyId: string, lr: LrView) {
  const [company, consignor, consignee, billedTo] = await Promise.all([
    loadPdfCompany(companyId, lr.snapshot?.company),
    partyOf(companyId, lr.snapshot?.consignor, lr.consignorId),
    partyOf(companyId, lr.snapshot?.consignee, lr.consigneeId),
    lr.billedToId ? partyOf(companyId, lr.snapshot?.billedTo, lr.billedToId) : null,
  ]);
  return { company, consignor, consignee, billedTo };
}

export async function loadLrPdf(companyId: string, id: string): Promise<LrPdfData | null> {
  const lr = await getLrById(companyId, id);
  if (!lr) return null;
  const { company, consignor, consignee, billedTo } = await lrParts(companyId, lr);
  if (!company) return null;
  return { lr, company, consignor, consignee, billedTo, mark: markOf(lr, !lr.bookedAt) };
}

// ---------- tax invoice ----------

export type InvoicePdfData = {
  invoice: TaxInvoice;
  /** Who is printed in the header: this company (own invoice) or the party that sold the goods. */
  seller: {
    own: boolean;
    name: string;
    address: string | null;
    gstin: string | null;
    pan: string | null;
    phone: string | null;
    logoSrc: string | null;
  };
  /** The company, for the bank block, invoice note and signature (own invoices only). */
  company: PdfCompany | null;
  billTo: PartySnapshot;
  shipTo: PartySnapshot | null;
  truckNumber: string | null;
  lrNos: string[];
  mark: PdfMark;
};

export async function loadInvoicePdf(
  companyId: string,
  id: string,
): Promise<InvoicePdfData | null> {
  const invoice = await getTaxInvoiceById(companyId, id);
  if (!invoice) return null;
  const own = invoice.sellerPartyId === null;
  const snap = invoice.snapshot;

  const [company, sellerParty, billTo, shipTo, truck, lrs] = await Promise.all([
    own
      ? loadPdfCompany(companyId, snap ? (snap.seller as CompanySnapshot) : null)
      : Promise.resolve(null),
    own ? null : partyOf(companyId, snap?.seller as PartySnapshot | undefined, invoice.sellerPartyId),
    partyOf(companyId, snap?.billTo, invoice.billToId),
    invoice.shipToId ? partyOf(companyId, snap?.shipTo, invoice.shipToId) : null,
    invoice.truckId ? getTruckById(companyId, invoice.truckId) : null,
    listLrsForInvoice(companyId, id),
  ]);
  if (!billTo || (own && !company) || (!own && !sellerParty)) return null;

  // A seller's own logo (party profile) gives the header its logo and watermark.
  // Party logos are a plain value until uploads exist: only our own company-folder links are read.
  const sellerLogo = own
    ? company!.logoSrc
    : await companyImage("logos", companyId, (await getPartyById(companyId, sellerParty!.id))?.logoUrl);
  const seller = own
    ? {
        own,
        name: company!.name,
        address: company!.office,
        gstin: company!.gstin,
        pan: company!.pan,
        phone: [company!.mobile1, company!.mobile2].filter(Boolean).join(", ") || null,
        logoSrc: sellerLogo,
      }
    : {
        own,
        name: sellerParty!.name + (sellerParty!.place ? ` – ${sellerParty!.place}` : ""),
        address: sellerParty!.address,
        gstin: sellerParty!.gstin,
        pan: sellerParty!.pan,
        phone: sellerParty!.phone,
        logoSrc: sellerLogo,
      };
  return {
    invoice,
    seller,
    company,
    billTo,
    shipTo,
    truckNumber: truck?.number ?? null,
    lrNos: lrs.map((l) => l.lrNo),
    mark: markOf(invoice, invoice.status === "draft"),
  };
}

// ---------- POD ----------

export type PodPdfData = {
  pod: Pod;
  lr: LrView;
  company: PdfCompany;
  consignor: PartySnapshot | null;
  consignee: PartySnapshot | null;
  billedTo: PartySnapshot | null;
  /** The signed copy: photos are embedded, PDFs are only listed by name. */
  copies: { name: string; src: string | null }[];
  mark: PdfMark;
};

/** At most this many signed-copy photos are printed (each is up to 3 MB). */
const MAX_POD_COPIES = 4;

export async function loadPodPdf(companyId: string, id: string): Promise<PodPdfData | null> {
  const pod = await getPodById(companyId, id);
  if (!pod) return null;
  const lr = await getLrById(companyId, pod.lrId);
  if (!lr) return null;
  const [{ company, consignor, consignee, billedTo }, copies] = await Promise.all([
    lrParts(companyId, lr),
    Promise.all(
      pod.documentUrls.slice(0, MAX_POD_COPIES + 4).map(async (url) => {
        const name = new URL(url, "http://x").searchParams.get("n") ?? "signed copy";
        if (/\.pdf$/i.test(name)) return { name, src: null };
        const src = await toDataUri(async () =>
          getObject("pod", podPathFromUrl(companyId, pod.lrId, url)),
        );
        return { name, src };
      }),
    ),
  ]);
  if (!company) return null;
  return {
    pod,
    lr,
    company,
    consignor,
    consignee,
    billedTo,
    copies,
    mark: markOf(pod, false),
  };
}

// ---------- freight bill ----------

export type BillPdfData = {
  bill: FreightBillView;
  company: PdfCompany;
  party: PartySnapshot;
  /** One per bill line, in line order. Null if the LR can't be read. */
  rows: { line: FreightBillView["lines"][number]; lr: LrView | null }[];
  /** Distinct consignors / consignees of the LRs on the bill. */
  shipFrom: PartySnapshot[];
  shipTo: PartySnapshot[];
  mark: PdfMark;
};

export async function loadBillPdf(companyId: string, id: string): Promise<BillPdfData | null> {
  const bill = await getFreightBillById(companyId, id);
  if (!bill) return null;
  const [company, party, lrs] = await Promise.all([
    loadPdfCompany(companyId, bill.snapshot?.company),
    partyOf(companyId, bill.snapshot?.party, bill.partyId),
    Promise.all(bill.lines.map((l) => getLrById(companyId, l.lrId))),
  ]);
  if (!company || !party) return null;

  const distinct = async (pick: (lr: LrView) => [PartySnapshot | null | undefined, string | null]) => {
    const seen = new Map<string, Promise<PartySnapshot | null>>();
    for (const lr of lrs) {
      if (!lr) continue;
      const [snap, pid] = pick(lr);
      const key = pid ?? snap?.id;
      if (key && !seen.has(key)) seen.set(key, partyOf(companyId, snap, pid));
    }
    return (await Promise.all(seen.values())).filter((p): p is PartySnapshot => !!p);
  };
  const [shipFrom, shipTo] = await Promise.all([
    distinct((lr) => [lr.snapshot?.consignor, lr.consignorId]),
    distinct((lr) => [lr.snapshot?.consignee, lr.consigneeId]),
  ]);

  return {
    bill,
    company,
    party,
    rows: bill.lines.map((line, i) => ({ line, lr: lrs[i] })),
    shipFrom,
    shipTo,
    mark: markOf(bill, bill.status === "draft"),
  };
}
