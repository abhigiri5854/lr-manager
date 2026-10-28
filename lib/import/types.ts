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
  /** Row number in the sheet (what the user sees in Excel). */
  rowNo: number;
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
};

export type ImportReadResult = ExcelReadResult | DocumentReadResult;

// ---------- the reader interface ----------
export type ReaderFile = { name: string; type: string; bytes: Uint8Array };

export interface ImportReader {
  readExcel(file: ReaderFile): Promise<ExcelReadResult>;
  readDocument(file: ReaderFile): Promise<DocumentReadResult>;
}
