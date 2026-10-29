import type { Party } from "@/lib/types";
import { IDS } from "./ids";

// Sample data only (from LRPDF, InvoicePDF, Parties designs).
// Modern Sanitation's GSTIN is copied from the design as-is; it fails the GSTIN checksum.
const acm = IDS.company.acm;
const base = {
  companyId: acm,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  version: 1,
  createdBy: null,
  updatedBy: null,
  logoUrl: null,
  defaultFrom: null,
  defaultPaymentMode: null,
  defaultGstPayer: null,
  defaultChargedAs: null,
  isSelf: false,
} as const;

export const mockParties: Party[] = [
  {
    ...base,
    id: IDS.party.ashirvad,
    name: "Ashirvad Pipes Pvt Ltd",
    place: "Painal",
    gstin: "10AABCA7061K2ZZ",
    pan: "AABCA7061K",
    phone: "7250015777",
    address:
      "Plot No 8461 & 8462, Khata No 1593 1594, Simaks Products Pvt Ltd, PS Bihta, Vill Mahmadpur, PO Painar, Painal, Patna",
    stateCode: "10",
    pincode: "801111",
    defaultFrom: "Painal",
    defaultPaymentMode: "tbb",
    defaultGstPayer: "consignor",
    defaultChargedAs: "ftl",
    source: "manual",
  },
  {
    ...base,
    id: IDS.party.maaVaishno,
    name: "Maa Vaishno Hardware",
    place: "Benibad, Muzaffarpur",
    gstin: "10FVWPS5035R1ZM",
    pan: "FVWPS5035R",
    phone: "7654141471",
    address: "Maa Vaishnavi Hardware, Kanta Pirouchha North, Benibad, Muzaffarpur 847107",
    stateCode: "10",
    pincode: "847107",
    source: "lr",
  },
  {
    ...base,
    id: IDS.party.modernSanitation,
    name: "Modern Sanitation",
    place: "Muzaffarpur",
    gstin: "10AAJFM3446M1ZA",
    pan: "AAJFM3446M",
    phone: null,
    address: null,
    stateCode: "10",
    pincode: null,
    source: "lr",
  },
  {
    ...base,
    id: IDS.party.india1789,
    name: "1789 India Trading",
    place: "Motihari",
    gstin: "10APIPP4518H1Z3",
    pan: "APIPP4518H",
    phone: "9199835232",
    address: "Bank Road, Motihari 845401",
    stateCode: "10",
    pincode: "845401",
    source: "invoice_scan",
  },
];
