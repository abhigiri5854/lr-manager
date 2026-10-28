import type { Driver, Truck } from "@/lib/types";
import { IDS } from "./ids";

// Sample data only (from Trucks.dc.html). Names, licences and document dates are blank in the design.
const base = {
  companyId: IDS.company.acm,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  version: 1,
} as const;

export const mockDrivers: Driver[] = [
  {
    ...base,
    id: IDS.driver.d7870,
    mobile: "7870015869",
    name: null,
    licenceNo: null,
    licenceExpiry: null,
    userId: IDS.user.driver,
    invitedAt: null,
  },
  {
    ...base,
    id: IDS.driver.d8873,
    mobile: "8873764100",
    name: null,
    licenceNo: null,
    licenceExpiry: null,
    userId: null,
    invitedAt: null,
  },
];

const noDocs = { rcExpiry: null, insuranceExpiry: null, permitExpiry: null, fitnessExpiry: null };

export const mockTrucks: Truck[] = [
  {
    ...base,
    ...noDocs,
    id: IDS.truck.br01gn8331,
    number: "BR01GN8331",
    driverId: IDS.driver.d7870,
    source: "lr",
  },
  {
    ...base,
    ...noDocs,
    id: IDS.truck.br06gb7374,
    number: "BR06GB7374",
    driverId: IDS.driver.d8873,
    source: "invoice_scan",
  },
];
