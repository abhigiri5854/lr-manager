import type { Item } from "@/lib/types";
import { IDS } from "./ids";

// Sample data only (item master rows behind invoice SQ2604002116).
const base = {
  companyId: IDS.company.acm,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  version: 1,
  hsn: "39251000",
  uom: "EA",
  gstRateBp: 1800,
} as const;

export const mockItems: Item[] = [
  {
    ...base,
    id: IDS.item.tank500x4,
    code: "70004162",
    name: "500 LTR 4-layer white water tank",
    lastRatePaise: 403004,
  },
  {
    ...base,
    id: IDS.item.tank1000x3,
    code: "70004144",
    name: "1000 LTR 3-layer white water tank",
    lastRatePaise: 715920,
  },
  {
    ...base,
    id: IDS.item.tank1000x4,
    code: "70004164",
    name: "1000 LTR 4-layer white water tank",
    lastRatePaise: 806007,
  },
];
