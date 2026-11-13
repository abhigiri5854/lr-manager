import { NotFoundError } from "./errors";
import * as db from "./db/truck-party-profile";
import { assertCan } from "./session";
import { onDatabase } from "./source";

export type { TruckPartyProfile, TruckPartyProfileChallan, TruckPartyProfilePayment } from "./db/truck-party-profile";

/** freight.view. Database only (like statement links); throws NotFoundError when missing. */
export async function getTruckPartyProfile(companyId: string, partyId: string) {
  await assertCan(companyId, "freight.view");
  if (!onDatabase()) throw new NotFoundError("Truck party");
  const p = await db.getTruckPartyProfile(companyId, partyId);
  if (!p) throw new NotFoundError("Truck party");
  return p;
}
