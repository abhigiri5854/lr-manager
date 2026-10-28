// Stand-in reader until the real ones exist (SheetJS for Excel, the Anthropic API for photos
// and PDFs). It never looks at the file's content: it returns the same realistic sample for
// any workbook, and one of three sample documents chosen by the file name. Keeping the
// output in the ImportReader shapes is the whole point — the real readers replace this file.
import type {
  DocumentReadResult,
  ExcelColumn,
  ExcelReadResult,
  ExcelRow,
  ImportReader,
  ReaderFile,
  ReadInvoice,
  ReadParty,
} from "./types";

// ---------- sample booking sheet (RSL_Booking_Report) ----------
const col = (
  header: string,
  sample: string,
  suggestedField: string,
  confidence: ExcelColumn["confidence"] = "sure",
): ExcelColumn => ({ header, sample, suggestedField, confidence });

const COLUMNS: ExcelColumn[] = [
  col("LR No", "19021", "lr_no"),
  col("LR Date", "15-10-2026", "lr_date"),
  col("From", "Painal", "from_place"),
  col("To", "Muzaffarpur", "to_place"),
  col("Consignor", "Ashirvad Pipes Pvt Ltd", "consignor_name"),
  col("Consignor GSTIN", "10AABCA7061K2ZZ", "consignor_gstin"),
  col("Consignee", "Maa Vaishno Hardware", "consignee_name"),
  col("Consignee GSTIN", "10FVWPS5035R1ZM", "consignee_gstin"),
  col("Invoice No", "SQ2604002201", "invoice_no"),
  col("Vehicle No", "BR01GN8331", "vehicle_no"),
  col("Pkgs", "28", "packages"),
  // Billing or actual weight? The reader isn't sure, like the design's "Confirm".
  col("Wt", "560.000", "billing_weight", "confirm"),
  col("Rate", "12.50", "rate"),
  col("Freight", "7,000.00", "freight"),
  col("Remarks 2", "Urgent", "skip", "confirm"),
];

type Party2 = readonly [name: string, gstin: string];

const ASHIRVAD: Party2 = ["Ashirvad Pipes Pvt Ltd", "10AABCA7061K2ZZ"];
const VAISHNO: Party2 = ["Maa Vaishno Hardware", "10FVWPS5035R1ZM"];
// Its GSTIN in the design fails the checksum, so the sheet leaves it blank and the party is matched by name.
const MODERN: Party2 = ["Modern Sanitation", ""];
const INDIA1789: Party2 = ["1789 India Trading", "10APIPP4518H1Z3"];

/** One sheet row, in COLUMNS order. */
function row(
  lrNo: string,
  date: string,
  from: string,
  to: string,
  consignor: Party2,
  consignee: Party2,
  invoiceNo: string,
  vehicle: string,
  pkgs: string,
  wt: string,
  rate: string,
  freight: string,
  remarks2 = "",
): string[] {
  return [
    lrNo,
    date,
    from,
    to,
    ...consignor,
    ...consignee,
    invoiceNo,
    vehicle,
    pkgs,
    wt,
    rate,
    freight,
    remarks2,
  ];
}

// 10 rows: 5 valid (one with a new party and truck), 1 existing LR (19019), 1 unusual vehicle no.,
// and 3 errors (GSTIN with 14 characters, missing LR no., LR no. repeated in the file).
const ROWS: string[][] = [
  row(
    "19021",
    "15-10-2026",
    "Painal",
    "Muzaffarpur",
    ASHIRVAD,
    VAISHNO,
    "SQ2604002201",
    "BR01GN8331",
    "28",
    "560.000",
    "12.50",
    "7,000.00",
    "Urgent",
  ),
  row(
    "19022",
    "16-10-2026",
    "Painal",
    "Muzaffarpur",
    ASHIRVAD,
    MODERN,
    "SQ2604002116",
    "BR06GB7374",
    "15",
    "1200.000",
    "10.00",
    "12,000.00",
  ),
  row(
    "19023",
    "17-10-2026",
    "Painal",
    "Motihari",
    ASHIRVAD,
    INDIA1789,
    "SQ2604002203",
    "BR 01 GN 8331",
    "40",
    "2100.000",
    "9.50",
    "19,950.00",
  ),
  row(
    "19024",
    "17-10-2026",
    "Ranchi",
    "Muzaffarpur",
    ["Shree Ganesh Traders", "20AABCS1234F1Z5"],
    VAISHNO,
    "",
    "BR01GA4455",
    "12",
    "380.000",
    "11.00",
    "4,180.00",
  ),
  row(
    "19019",
    "14-10-2026",
    "Painal",
    "Gaighat (MUZ)",
    ASHIRVAD,
    VAISHNO,
    "SQ2604002116",
    "BR01GN8331",
    "28",
    "564.000",
    "12.50",
    "7,050.00",
  ),
  row(
    "19025",
    "18-10-2026",
    "Painal",
    "Muzaffarpur",
    ASHIRVAD,
    MODERN,
    "SQ2604002205",
    "BR1GN",
    "9",
    "300.000",
    "10.00",
    "3,000.00",
  ),
  row(
    "19026",
    "18-10-2026",
    "Patna",
    "Muzaffarpur",
    ["Patel Cement Traders", "10AABCP3456L1Z"],
    VAISHNO,
    "SQ2604002206",
    "BR01GN8331",
    "20",
    "800.000",
    "10.00",
    "8,000.00",
  ),
  row(
    "",
    "19-10-2026",
    "Painal",
    "Muzaffarpur",
    ASHIRVAD,
    VAISHNO,
    "SQ2604002207",
    "BR06GB7374",
    "6",
    "150.000",
    "10.00",
    "1,500.00",
  ),
  row(
    "19022",
    "19-10-2026",
    "Painal",
    "Muzaffarpur",
    ASHIRVAD,
    MODERN,
    "SQ2604002208",
    "BR06GB7374",
    "10",
    "410.000",
    "10.00",
    "4,100.00",
  ),
  row(
    "19027",
    "20-10-2026",
    "Painal",
    "Motihari",
    ASHIRVAD,
    INDIA1789,
    "SQ2604002209",
    "BR06GB7374",
    "33",
    "1500.000",
    "9.50",
    "14,250.00",
  ),
];

const HEADER_ROW = 3;

function sampleSheet(): ExcelReadResult {
  const rows: ExcelRow[] = ROWS.map((cells, i) => ({
    rowNo: HEADER_ROW + 1 + i,
    cells: Object.fromEntries(COLUMNS.map((c, k) => [c.header, cells[k]])),
  }));
  return {
    kind: "excel",
    sheetName: "Sheet1",
    headerRow: HEADER_ROW,
    columns: COLUMNS.map((c) => ({ ...c })),
    rows,
  };
}

// ---------- sample documents ----------
const party = (p: Partial<ReadParty> & Pick<ReadParty, "name">): ReadParty => ({
  place: null,
  gstin: null,
  pan: null,
  phone: null,
  address: null,
  stateCode: null,
  pincode: null,
  ...p,
});

const ASHIRVAD_PARTY = party({
  name: "Ashirvad Pipes Pvt Ltd",
  place: "Painal",
  gstin: "10AABCA7061K2ZZ",
  pan: "AABCA7061K",
  phone: "7250015777",
  address:
    "Plot No 8461 & 8462, Khata No 1593 1594, Simaks Products Pvt Ltd, PS Bihta, Vill Mahmadpur, PO Painar, Painal, Patna",
  stateCode: "10",
  pincode: "801111",
});

const INDIA_1789 = party({
  name: "1789 India Trading",
  place: "Motihari",
  gstin: "10APIPP4518H1Z3",
  pan: "APIPP4518H",
  phone: "9199835232",
  address: "Bank Road, Motihari 845401",
  stateCode: "10",
  pincode: "845401",
});

/** SQ2604002116 — the sample invoice of Invoice.dc.html. */
function invoiceSQ2116(): DocumentReadResult {
  const invoice: ReadInvoice = {
    invoiceNo: "SQ2604002116",
    invoiceAt: "2026-10-10T06:27:00.000Z",
    seller: ASHIRVAD_PARTY,
    billTo: INDIA_1789,
    shipTo: null,
    customerRef: "1789-80520-",
    customerRefDate: "2026-10-07",
    soNo: "300717994",
    soDate: null,
    doNo: "801445107",
    sapRef: null,
    transporterName: null,
    vehicleNo: "BR06GB7374",
    driverMobile: "8873764100",
    shipFrom: null,
    incoterm: "Ex Works with Insurance",
    ewayBillNo: null,
    lines: [
      {
        itemCode: "70004162",
        description: "500 LTR 4-layer white water tank",
        hsn: "39251000",
        uom: "EA",
        qty: "10",
        ratePaise: 403004,
        discountPaise: 0,
        gstRateBp: 1800,
      },
      {
        itemCode: "70004144",
        description: "1000 LTR 3-layer white water tank",
        hsn: "39251000",
        uom: "EA",
        qty: "5",
        ratePaise: 715920,
        discountPaise: 0,
        gstRateBp: 1800,
      },
      {
        itemCode: "70004164",
        description: "1000 LTR 4-layer white water tank",
        hsn: "39251000",
        uom: "EA",
        qty: "10",
        ratePaise: 806007,
        discountPaise: 0,
        gstRateBp: 1800,
      },
    ],
  };
  return {
    kind: "document",
    documentType: "tax_invoice",
    pages: 1,
    summary: "Seller, buyer, 3 items, taxable ₹1,56,697.10, truck BR06GB7374",
    invoice,
    lr: null,
    lowConfidence: ["customerRefDate", "soNo"],
  };
}

/** A second invoice with a buyer, truck and items that aren't in the system yet. */
function invoiceNew(): DocumentReadResult {
  const invoice: ReadInvoice = {
    invoiceNo: "SQ2604002117",
    invoiceAt: "2026-10-12T05:10:00.000Z",
    seller: ASHIRVAD_PARTY,
    billTo: party({
      name: "Shree Ganesh Traders",
      place: "Ranchi",
      gstin: "20AABCS1234F1Z5",
      pan: "AABCS1234F",
      phone: "9431000111",
      address: "Main Road, Ranchi 834001",
      stateCode: "20",
      pincode: "834001",
    }),
    shipTo: null,
    customerRef: "SGT-221",
    customerRefDate: "2026-10-09",
    soNo: "300718002",
    soDate: "2026-10-09",
    doNo: "801445190",
    sapRef: null,
    transporterName: null,
    vehicleNo: "BR01GA4455",
    driverMobile: "9934001122",
    shipFrom: "Painal",
    incoterm: "FOR destination",
    ewayBillNo: null,
    lines: [
      {
        itemCode: "70009001",
        description: "300 LTR 3-layer blue water tank",
        hsn: "39251000",
        uom: "EA",
        qty: "8",
        ratePaise: 285000,
        discountPaise: 0,
        gstRateBp: 1800,
      },
      {
        itemCode: "70004162",
        description: "500 LTR 4-layer white water tank",
        hsn: "39251000",
        uom: "EA",
        qty: "4",
        ratePaise: 403004,
        discountPaise: 0,
        gstRateBp: 1800,
      },
    ],
  };
  return {
    kind: "document",
    documentType: "tax_invoice",
    pages: 1,
    summary: "Seller, new buyer Shree Ganesh Traders, 2 items, truck BR01GA4455",
    invoice,
    lr: null,
    lowConfidence: ["lines.0.hsn"],
  };
}

/** LR_19019 — a consignment note that is already in the system. */
function consignmentNote(): DocumentReadResult {
  return {
    kind: "document",
    documentType: "lr",
    pages: 1,
    summary: "LR 19019, 28 pkgs water tank, Painal → Gaighat, e-way 801755453075",
    invoice: null,
    lr: {
      lrNo: "19019",
      lrDate: "2026-10-14",
      consignor: "Ashirvad Pipes Pvt Ltd",
      consignee: "Maa Vaishno Hardware",
      fromPlace: "Painal",
      toPlace: "Gaighat",
      packages: 28,
      description: "Water tank",
      ewayBillNo: "801755453075",
    },
    lowConfidence: [],
  };
}

/** Which sample a document gets: LR_… → consignment note; …new… / …2117… → new-records invoice. */
export function sampleFor(fileName: string): "lr" | "invoice_new" | "invoice" {
  const base = fileName.toLowerCase();
  if (/^lr[\s_.-]*\d/.test(base)) return "lr";
  if (/new|2117/.test(base)) return "invoice_new";
  return "invoice";
}

export const mockReader: ImportReader = {
  async readExcel() {
    return sampleSheet();
  },
  async readDocument(file: ReaderFile) {
    const which = sampleFor(file.name);
    return which === "lr"
      ? consignmentNote()
      : which === "invoice_new"
        ? invoiceNew()
        : invoiceSQ2116();
  },
};
