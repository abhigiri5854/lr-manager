import type { Membership, User } from "@/lib/types";
import { IDS } from "./ids";

// Sample data only (design/screens/Users.dc.html shows placeholders for names).
const t = "2026-04-01T00:00:00.000Z";

export const mockUsers: User[] = [
  {
    id: IDS.user.owner,
    createdAt: t,
    updatedAt: t,
    name: "Owner",
    mobile: null,
    email: null,
    lastLoginAt: null,
  },
  {
    id: IDS.user.staff,
    createdAt: t,
    updatedAt: t,
    name: "Booking staff",
    mobile: null,
    email: null,
    lastLoginAt: null,
  },
  {
    id: IDS.user.driver,
    createdAt: t,
    updatedAt: t,
    name: "Driver",
    mobile: "7870015869",
    email: null,
    lastLoginAt: null,
  },
];

export const mockMemberships: Membership[] = [
  {
    id: IDS.membership.ownerAcm,
    companyId: IDS.company.acm,
    userId: IDS.user.owner,
    role: "owner",
    createdAt: t,
    updatedAt: t,
    version: 1,
  },
  {
    id: IDS.membership.ownerRs,
    companyId: IDS.company.rs,
    userId: IDS.user.owner,
    role: "owner",
    createdAt: t,
    updatedAt: t,
    version: 1,
  },
  {
    id: IDS.membership.staffAcm,
    companyId: IDS.company.acm,
    userId: IDS.user.staff,
    role: "booking_staff",
    createdAt: t,
    updatedAt: t,
    version: 1,
  },
  {
    id: IDS.membership.driverAcm,
    companyId: IDS.company.acm,
    userId: IDS.user.driver,
    role: "driver",
    createdAt: t,
    updatedAt: t,
    version: 1,
  },
];
