import { z } from "zod";
import { isoDate, isoDateTime, mobileSchema, optional, optionalText, uuid } from "./common";

/** POD screen: delivery details + receipt. deliveredOn is written to Lr.deliveredAt. */
export const podFields = z.object({
  lrId: uuid,
  deliveredOn: isoDate,
  receivedBy: optionalText(100),
  receiverPhone: optional(mobileSchema),
  packagesReceived: optional(z.number().int().nonnegative()),
  condition: z.enum(["good", "short", "damaged"]).optional(),
  remarks: optionalText(500),
  documentUrls: z.array(z.string().min(1).max(500)).optional(),
  /** When the signed copy arrived; defaults to now when the first document is attached. */
  receivedAt: optional(isoDateTime),
});
export type PodInput = z.input<typeof podFields>;
