// Domain types shared by screens and the data layer (lib/data).
// Money is integer paise; weights are Postgres numeric kept as strings; dates are ISO strings.

// ---------- shared ----------
export type Uuid = string;
/** "2026-10-14" */
export type IsoDate = string;
/** "2026-10-14T06:27:00.000Z" */
export type IsoDateTime = string;
/** Integer paise. */
export type Paise = number;
/** Postgres numeric kept as a string, e.g. "564.000". */
export type Decimal = string;

/** Every company-scoped business record. */
export type BaseRecord = {
  id: Uuid;
  companyId: Uuid;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  cancelledAt?: IsoDateTime;
  /** Bumped on every update; update() takes expectedVersion and throws ConflictError on mismatch. */
  version: number;
};

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };

export type Role = "owner" | "accountant" | "booking_staff" | "driver";
export type LrPaymentMode = "to_pay" | "paid" | "tbb";
export type GstPayer = "consignor" | "consignee" | "transporter";
export type ChargedAs = "ftl" | "per_kg" | "per_pkg";
export type Risk = "owner" | "carrier";
export type PodCondition = "good" | "short" | "damaged";
export type FreightGstMode = "reverse_charge" | "forward_charge";
export type ReceiptMode = "neft_upi" | "cheque" | "cash";
export type RecordSource = "manual" | "lr" | "invoice_scan" | "excel_import";
export type LrStatus =
  | "Draft"
  | "Booked"
  | "In transit"
  | "Delivered"
  | "POD received"
  | "Billed"
  | "Paid"
  | "Cancelled";

// ---------- company & users ----------
export type BankAccount = {
  accountName: string;
  bankName: string;
  accountNo: string;
  ifsc: string;
};

export type Company = {
  id: Uuid;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  cancelledAt?: IsoDateTime;
  version: number;
  /** "ACM Logistics" (company switcher) */
  label: string;
  /** "ACM LOGISTICS" (printed) */
  name: string;
  city: string;
  office: string;
  email: string | null;
  website: string | null;
  mobile1: string | null;
  mobile2: string | null;
  gstin: string;
  pan: string;
  udyam: string | null;
  bank: BankAccount | null;
  // invoice & document defaults
  /** "FREIGHT INVOICE" */
  invoiceTitle: string;
  invoiceNote: string | null;
  /** "ACM/FB/26-27/" */
  freightBillPrefix: string;
  signatoryName: string | null;
  // LR terms & numbering (null = not set yet)
  /** "" allowed */
  lrPrefix: string;
  /** Shown in Settings; real allocation goes through the number series. */
  nextLrNo: number | null;
  jurisdiction: string | null;
  podDays: number | null;
  podPenaltyPerDay: Paise | null;
  /** ["Consignor", "Consignee", "Driver", "Office"] */
  lrCopies: string[];
  /** Free text, printed as-is. */
  detention: string | null;
  lrTerms: string | null;
  // branding
  logoUrl: string | null;
  useLogoWatermark: boolean;
  signatureUrl: string | null;
};

export type User = {
  id: Uuid;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  cancelledAt?: IsoDateTime;
  name: string;
  mobile: string | null;
  email: string | null;
  lastLoginAt: IsoDateTime | null;
};

export type Membership = BaseRecord & { userId: Uuid; role: Role };

// ---------- masters ----------
export type Party = BaseRecord & {
  /** "Ashirvad Pipes Pvt Ltd" */
  name: string;
  /** "Painal" (shown as "name – place") */
  place: string | null;
  /** Unique per company. */
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  address: string | null;
  /** "10" */
  stateCode: string | null;
  pincode: string | null;
  /** Seller header on the goods-invoice PDF. */
  logoUrl: string | null;
  defaultFrom: string | null;
  defaultPaymentMode: LrPaymentMode | null;
  defaultGstPayer: GstPayer | null;
  defaultChargedAs: ChargedAs | null;
  source: RecordSource;
};

export type Truck = BaseRecord & {
  /** Normalised "BR01GN8331", unique per company. */
  number: string;
  driverId: Uuid | null;
  rcExpiry: IsoDate | null;
  insuranceExpiry: IsoDate | null;
  permitExpiry: IsoDate | null;
  fitnessExpiry: IsoDate | null;
  source: RecordSource;
};

/** A driver's "usual truck" is read from Truck.driverId (single link). */
export type Driver = BaseRecord & {
  mobile: string;
  name: string | null;
  licenceNo: string | null;
  licenceExpiry: IsoDate | null;
  userId: Uuid | null;
  invitedAt: IsoDateTime | null;
};

export type Item = BaseRecord & {
  code: string | null;
  name: string;
  hsn: string | null;
  uom: string | null;
  /** 1800 = 18% */
  gstRateBp: number | null;
  lastRatePaise: Paise | null;
};

// ---------- snapshots (stored on finalised documents) ----------
export type PartySnapshot = Pick<
  Party,
  "id" | "name" | "place" | "gstin" | "pan" | "phone" | "address" | "stateCode" | "pincode"
>;
export type CompanySnapshot = Omit<
  Company,
  "createdAt" | "updatedAt" | "cancelledAt" | "version" | "nextLrNo"
>;

// ---------- LR ----------
export type LrItem = {
  id: Uuid;
  itemId: Uuid | null;
  /** "Said to contain" */
  description: string;
  packages: number;
  actualWeight: Decimal | null;
  chargedWeight: Decimal | null;
  /** "22 FEET" */
  size: string | null;
};

/** Balance and grand total are computed, not stored. */
export type LrCharges = {
  freight: Paise | null;
  packing: Paise | null;
  cnCharge: Paise | null;
  loading: Paise | null;
  unloading: Paise | null;
  detention: Paise | null;
  other: Paise | null;
  gst: Paise | null;
  advance: Paise | null;
};

/** One goods invoice carried on the LR (an LR can carry several). */
export type LrInvoice = {
  id: Uuid;
  invoiceNo: string;
  invoiceDate: IsoDate | null;
  valuePaise: Paise | null;
  ewayBillNo: string | null;
  ewayExpiresAt: IsoDateTime | null;
  /** The only LR ↔ tax invoice link. */
  taxInvoiceId: Uuid | null;
};

export type LrSnapshot = {
  company: CompanySnapshot;
  consignor: PartySnapshot | null;
  consignee: PartySnapshot | null;
  billedTo: PartySnapshot | null;
};

export type Lr = BaseRecord & {
  /** Prefix + number, allocated on create. */
  lrNo: string;
  /** Null while draft. */
  lrDate: IsoDate | null;
  fromPlace: string | null;
  toPlace: string | null;
  risk: Risk;
  consignorId: Uuid | null;
  consigneeId: Uuid | null;
  billedToId: Uuid | null;
  gstPaidBy: GstPayer | null;
  paymentMode: LrPaymentMode | null;
  chargedAs: ChargedAs | null;
  ratePaise: Paise | null;
  truckId: Uuid | null;
  driverMobile: string | null;
  lrInvoices: LrInvoice[];
  items: LrItem[];
  charges: LrCharges;
  remarks: string | null;
  // lifecycle stamps the LR owns
  /** Null = draft. */
  bookedAt: IsoDateTime | null;
  dispatchedAt: IsoDateTime | null;
  /** The single delivery date (Pod doesn't repeat it). */
  deliveredAt: IsoDateTime | null;
  /** Set when booked. */
  snapshot: LrSnapshot | null;
};

/** What lib/lr-status.ts needs; lib/data/lrs fills POD/bill/paid from linked records. */
export type LrStatusInput = Pick<
  Lr,
  "cancelledAt" | "bookedAt" | "dispatchedAt" | "deliveredAt"
> & {
  podReceivedAt: IsoDateTime | null;
  billedAt: IsoDateTime | null;
  paidAt: IsoDateTime | null;
};

/** Row returned by lrs.list / getById: the record plus derived status and display names. */
export type LrView = Lr & {
  status: LrStatus;
  consignorName: string | null;
  consigneeName: string | null;
  billedToName: string | null;
  truckNumber: string | null;
  totalPackages: number;
  /** Sum of lrInvoices values. */
  totalValuePaise: Paise | null;
  /** Earliest across lrInvoices (register column / alerts). */
  ewayExpiresAt: IsoDateTime | null;
};

// ---------- tax (goods) invoice ----------
export type TaxInvoiceLine = {
  id: Uuid;
  lineNo: number;
  itemId: Uuid | null;
  itemCode: string | null;
  description: string;
  hsn: string | null;
  uom: string | null;
  qty: Decimal;
  ratePaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  gstRateBp: number;
  sgstPaise: Paise;
  cgstPaise: Paise;
  igstPaise: Paise;
};

export type TaxInvoiceTotals = {
  taxablePaise: Paise;
  sgstPaise: Paise;
  cgstPaise: Paise;
  igstPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
};

export type TaxInvoice = BaseRecord & {
  invoiceNo: string;
  invoiceAt: IsoDateTime;
  status: "draft" | "final";
  /** Null = this company is the seller. */
  sellerPartyId: Uuid | null;
  billToId: Uuid;
  /** Null = same as bill to. */
  shipToId: Uuid | null;
  placeOfSupplyStateCode: string;
  customerRef: string | null;
  customerRefDate: IsoDate | null;
  soNo: string | null;
  soDate: IsoDate | null;
  doNo: string | null;
  sapRef: string | null;
  /** The LR link lives on LrInvoice only. */
  truckId: Uuid | null;
  driverMobile: string | null;
  shipFrom: string | null;
  incoterm: string | null;
  lines: TaxInvoiceLine[];
  totals: TaxInvoiceTotals;
  irn: string | null;
  ewayBillNo: string | null;
  sourceFileUrl: string | null;
  importBatchId: Uuid | null;
  snapshot: {
    seller: PartySnapshot | CompanySnapshot;
    billTo: PartySnapshot;
    shipTo: PartySnapshot | null;
  } | null;
};

// ---------- POD ----------
export type Pod = BaseRecord & {
  lrId: Uuid;
  receivedBy: string | null;
  receiverPhone: string | null;
  packagesReceived: number | null;
  condition: PodCondition;
  remarks: string | null;
  documentUrls: string[];
  /** When the signed copy arrived (= "POD received"). */
  receivedAt: IsoDateTime | null;
};

// ---------- freight bills & payments ----------
export type FreightBillLine = {
  id: Uuid;
  lrId: Uuid;
  freightPaise: Paise;
  detentionPaise: Paise;
  otherPaise: Paise;
  advancePaise: Paise;
  totalPaise: Paise;
};

export type FreightBillTotals = {
  chargesPaise: Paise;
  sgstPaise: Paise;
  cgstPaise: Paise;
  igstPaise: Paise;
  advancePaise: Paise;
  amountPaise: Paise;
};

export type FreightBill = BaseRecord & {
  status: "draft" | "final";
  /** Null until finalised; allocated only on finalise (no gaps). */
  billNo: string | null;
  billDate: IsoDate;
  partyId: Uuid;
  gstMode: FreightGstMode;
  /** Used under forward charge; tax is 0 under reverse charge. */
  gstRateBp: number;
  lines: FreightBillLine[];
  totals: FreightBillTotals;
  snapshot: { company: CompanySnapshot; party: PartySnapshot } | null;
};

export type PaymentAllocation = { freightBillId: Uuid; amountPaise: Paise };

export type Payment = BaseRecord & {
  partyId: Uuid;
  /** Empty = on-account advance. */
  allocations: PaymentAllocation[];
  amountPaise: Paise;
  tdsPaise: Paise;
  mode: ReceiptMode;
  receivedOn: IsoDate;
  reference: string | null;
};

// ---------- import & audit ----------
export type ImportBatch = BaseRecord & {
  fileName: string;
  fileUrl: string | null;
  kind: "excel" | "csv" | "pdf" | "image";
  detectedAs: "booking_report" | "tax_invoice" | "lr" | "pod" | "eway_bill" | "unknown";
  status: "uploaded" | "read" | "reviewed" | "imported" | "failed";
  mappingName: string | null;
  counts: { valid: number; warning: number; error: number };
  createdRecordIds: Uuid[];
};

export type AuditEntry = {
  id: Uuid;
  companyId: Uuid;
  createdAt: IsoDateTime;
  /** "system" for imports and scheduled jobs. */
  userId: Uuid | "system";
  table: string;
  recordId: Uuid;
  action: "create" | "update" | "cancel";
  changes: { field: string; old: unknown; new: unknown }[];
};

// ---------- views ----------
/** trucks.list / getById: truck plus its driver's details. */
export type TruckView = Truck & { driverMobile: string | null; driverName: string | null };

/** drivers.list / getById: driver plus the trucks that point at them (Truck.driverId). */
export type DriverView = Driver & { truckNumbers: string[] };

/** bills.list / getById: bill plus what has been received against it. */
export type FreightBillView = FreightBill & {
  partyName: string;
  /** Sum of payment allocations (incl. TDS) against this bill. */
  receivedPaise: Paise;
  duePaise: Paise;
  lrNos: string[];
};

/** An LR that has been delivered but whose POD has not been received. */
export type PodPendingRow = {
  lrId: Uuid;
  lrNo: string;
  /** ISO date */
  deliveredOn: IsoDate;
  consignee: string;
  daysSinceDelivery: number;
  /** Penalty accrued so far, in paise (per company POD rules). */
  penaltyPaise: Paise;
};

// ---------- dashboard ----------
/** Something on the dashboard's "Needs attention" list. The screen writes the wording. */
export type AttentionItem =
  | {
      kind: "eway_expired" | "eway_expiring";
      lrId: Uuid;
      lrNo: string;
      ewayBillNo: string;
      expiresAt: IsoDateTime;
    }
  | {
      kind: "pod_overdue";
      lrId: Uuid;
      lrNo: string;
      daysOverdue: number;
      podDays: number;
      penaltyPerDayPaise: Paise | null;
      penaltyPaise: Paise;
    }
  | {
      kind: "draft_incomplete";
      lrId: Uuid;
      lrNo: string;
      /** Short labels, e.g. ["e-way bill no.", "weight"]. */
      missing: string[];
    };

/** A consignor → consignee pair, with the latest LR to copy from. */
export type RepeatRoute = {
  /** Latest LR for this pair (used for /lr/new?from=). */
  lrId: Uuid;
  consignorName: string;
  consigneeName: string;
  fromPlace: string | null;
  toPlace: string | null;
  chargedAs: ChargedAs | null;
  paymentMode: LrPaymentMode | null;
  lastUsedOn: IsoDate;
  count: number;
};

export type Dashboard = {
  openLrs: { total: number; draft: number; booked: number; inTransit: number };
  /** E-way bills on undelivered LRs that expire within 24 h or have expired. */
  eway: { total: number; expired: number };
  pod: { pending: number; podDays: number | null };
  freight: {
    /** Due on finalised freight bills. Null when nothing has been billed yet. */
    toCollectPaise: Paise | null;
    /** Booked TBB LRs not on any bill. */
    unbilledTbbLrs: number;
  };
  recentLrs: LrView[];
  attention: AttentionItem[];
  repeatRoutes: RepeatRoute[];
};
