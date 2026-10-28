import { z } from "zod";
import { mobileSchema, optional, text } from "./common";

/** Roles an Owner can give from Users & roles. Drivers are added from Trucks & drivers. */
export const OFFICE_ROLES = ["owner", "accountant", "booking_staff"] as const;

export const inviteMemberSchema = z.object({
  name: text(100),
  mobile: mobileSchema,
  email: optional(z.email("Email looks wrong").transform((v) => v.toLowerCase())),
  role: z.enum(OFFICE_ROLES, "Pick a role"),
});
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;
