// What an import reader hands back. Readers (the mock one now; SheetJS and the Anthropic API
// later) only produce these shapes — review, validation and saving all work from them, so
// swapping the reader changes nothing else. No imports from lib/types (it imports this file).

// ---------- Excel / CSV ----------
export type ColumnConfidence = "sure" | "confirm";

export type ExcelColumn = {
  /** Header text as it appears in the file. */
  header: string;
  /** First non-empty value under it, shown in the mapping table. */
  sample: string;
  /** Key from lib/import/fields.ts, or "skip" (don't import). */
  suggestedField: string;
  confidence: ColumnConfidence;
};

export type ExcelRow = {
  /**
   * Row number in the sheet (what the user sees in Excel). Unique within the file: rows from a
   * second sheet continue after the first sheet's, see `sheet`.
   */
  rowNo: number;
  /** Only on rows from a sheet other than the first one read: its name and the row number in it. */
  sheet?: string;
  sheetRow?: number;
  /** Raw cell text by header. */
  cells: Record<string, string>;
};

export type ExcelReadResult = {
  kind: "excel";
  sheetName: string;
  headerRow: number;
  columns: ExcelColumn[];
  rows: ExcelRow[];
};

// ---------- invoices, LRs and other documents ----------
export type ReadParty = {
  name: string;
  place: string | null;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  address: string | null;
  stateCode: string | null;
  pincode: string | null;
};

export type ReadInvoiceLine = {
  itemCode: string | null;
  description: string;
  hsn: string | null;
  uom: string | null;
  qty: string;
  ratePaise: number;
  discountPaise: number;
  gstRateBp: number;
};

export type ReadInvoice = {
  invoiceNo: string;
  /** ISO timestamp. */
  invoiceAt: string;
  seller: ReadParty;
  billTo: ReadParty;
  shipTo: ReadParty | null;
  customerRef: string | null;
  /** yyyy-mm-dd */
  customerRefDate: string | null;
  soNo: string | null;
  soDate: string | null;
  doNo: string | null;
  sapRef: string | null;
  transporterName: string | null;
  vehicleNo: string | null;
  driverMobile: string | null;
  shipFrom: string | null;
  incoterm: string | null;
  ewayBillNo: string | null;
  /** From the e-invoice QR when the file has one. */
  irn?: string | null;
  /** The signed QR text (JWT) as printed, so the tax invoice PDF can print the same QR. */
  qrPayload?: string | null;
  lines: ReadInvoiceLine[];
};

export type ReadLr = {
  lrNo: string;
  lrDate: string | null;
  consignor: string;
  consignee: string;
  fromPlace: string | null;
  toPlace: string | null;
  packages: number;
  description: string;
  ewayBillNo: string | null;
};

/** How a document was read, cheapest first. The mock reader leaves it out. */
export type ReadSource = "qr" | "pdf_text" | "gemini";

export const READ_SOURCE_LABEL: Record<ReadSource, string> = {
  qr: "QR",
  pdf_text: "PDF text",
  gemini: "Gemini",
};

export type DocumentType = "tax_invoice" | "lr" | "pod" | "eway_bill" | "unknown";

export type DocumentReadResult = {
  kind: "document";
  documentType: DocumentType;
  pages: number;
  /** One line for the Files table, e.g. "Seller, buyer, 3 items, taxable ₹1,56,697.10, truck BR06GB7374". */
  summary: string;
  invoice: ReadInvoice | null;
  lr: ReadLr | null;
  /**
   * Fields the reader wasn't sure about, as paths in the Tax invoice form: "invoiceNo",
   * "customerRefDate", "billTo", "truck", "lines.1.hsn". Shown orange for the user to check.
   */
  lowConfidence: string[];
  /** Which readers supplied the fields, in the order they ran. */
  readBy?: ReadSource[];
};

export type ImportReadResult = ExcelReadResult | DocumentReadResult;

// ---------- the reader interface ----------
export type ReaderFile = { name: string; type: string; bytes: Uint8Array };

/** What the company already knows, handed to the sheet reader so it can place columns without AI. */
export type ExcelHints = {
  /** The company's saved mappings (header → field), best match for this sheet first. */
  savedMappings?: Record<string, string>[];
  /** Asked once, with header names and sample rows only, for columns nothing else could place. */
  suggestColumns?: (
    q: import("./column-suggest").ColumnQuestion,
  ) => Promise<{ header: string; field: string }[] | null>;
};

export interface ImportReader {
  readExcel(file: ReaderFile, hints?: ExcelHints): Promise<ExcelReadResult>;
  readDocument(file: ReaderFile): Promise<DocumentReadResult>;
}
