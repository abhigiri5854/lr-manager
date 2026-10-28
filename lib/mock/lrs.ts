import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import type { Lr, LrCharges } from "@/lib/types";
import { mockCompanies } from "./companies";
import { IDS } from "./ids";
import { mockParties } from "./parties";

// Sample data only: LR 19019 (booked, in transit) and draft LR 19020 (made from invoice SQ2604002116).
const noCharges: LrCharges = {
  freight: null,
  packing: null,
  cnCharge: null,
  loading: null,
  unloading: null,
  detention: null,
  other: null,
  gst: null,
  advance: null,
};

const party = (id: string) => partySnapshot(mockParties.find((p) => p.id === id)!);
const acm = mockCompanies.find((c) => c.id === IDS.company.acm)!;

export const mockLrs: Lr[] = [
  {
    id: IDS.lr.lr19019,
    companyId: IDS.company.acm,
    createdAt: "2026-10-14T05:30:00.000Z",
    updatedAt: "2026-10-14T05:30:00.000Z",
    version: 1,
    lrNo: "19019",
    lrDate: "2026-10-14",
    fromPlace: "Painal",
    toPlace: "Gaighat (MUZ)",
    risk: "owner",
    consignorId: IDS.party.ashirvad,
    consigneeId: IDS.party.maaVaishno,
    billedToId: IDS.party.modernSanitation,
    gstPaidBy: "consignor",
    paymentMode: "tbb",
    chargedAs: "ftl",
    ratePaise: null,
    truckId: IDS.truck.br01gn8331,
    driverMobile: "7870015869",
    lrInvoices: [
      {
        id: IDS.lrInvoice.a,
        invoiceNo: "182604002150",
        invoiceDate: "2026-10-10",
        valuePaise: 17935600,
        ewayBillNo: "801755453075",
        ewayExpiresAt: "2026-10-15T18:29:59.000Z", // end of 15-10-2026 IST
        taxInvoiceId: null,
      },
    ],
    items: [
      {
        id: IDS.lrItem.a,
        itemId: null,
        description: "Water tank",
        packages: 28,
        actualWeight: null,
        chargedWeight: "564.000",
        size: "22 FEET",
      },
    ],
    charges: noCharges,
    remarks: null,
    bookedAt: "2026-10-14T05:30:00.000Z",
    dispatchedAt: "2026-10-14T05:30:00.000Z",
    deliveredAt: null,
    snapshot: {
      company: companySnapshot(acm),
      consignor: party(IDS.party.ashirvad),
      consignee: party(IDS.party.maaVaishno),
      billedTo: party(IDS.party.modernSanitation),
    },
  },
  {
    id: IDS.lr.lr19020,
    companyId: IDS.company.acm,
    createdAt: "2026-10-27T09:05:00.000Z",
    updatedAt: "2026-10-27T09:05:00.000Z",
    version: 1,
    lrNo: "19020",
    lrDate: null,
    fromPlace: "Painal",
    toPlace: "Motihari",
    risk: "owner",
    consignorId: IDS.party.ashirvad,
    consigneeId: IDS.party.india1789,
    billedToId: null,
    gstPaidBy: "consignor",
    paymentMode: "tbb",
    chargedAs: "ftl",
    ratePaise: null,
    truckId: IDS.truck.br06gb7374,
    driverMobile: "8873764100",
    lrInvoices: [
      {
        id: IDS.lrInvoice.b,
        invoiceNo: "SQ2604002116",
        invoiceDate: "2026-10-10",
        valuePaise: 18490258,
        ewayBillNo: null,
        ewayExpiresAt: null,
        taxInvoiceId: IDS.invoice.sq2604002116,
      },
    ],
    items: [
      {
        id: IDS.lrItem.b,
        itemId: IDS.item.tank500x4,
        description: "500 LTR 4-layer white water tank",
        packages: 10,
        actualWeight: null,
        chargedWeight: null,
        size: null,
      },
      {
        id: IDS.lrItem.c,
        itemId: IDS.item.tank1000x3,
        description: "1000 LTR 3-layer white water tank",
        packages: 5,
        actualWeight: null,
        chargedWeight: null,
        size: null,
      },
      {
        id: IDS.lrItem.d,
        itemId: IDS.item.tank1000x4,
        description: "1000 LTR 4-layer white water tank",
        packages: 10,
        actualWeight: null,
        chargedWeight: null,
        size: null,
      },
    ],
    charges: noCharges,
    remarks: null,
    bookedAt: null,
    dispatchedAt: null,
    deliveredAt: null,
    snapshot: null,
  },
];
