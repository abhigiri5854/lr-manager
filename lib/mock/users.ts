import type { Membership, User } from "@/lib/types";
import { IDS } from "./ids";

// Sample data only (design/screens/Users.dc.html shows placeholders for names and mobiles).
const t = "2026-04-01T00:00:00.000Z";

export const mockUsers: User[] = [
  {
    id: IDS.user.owner,
    createdAt: t,
    updatedAt: t,
    name: "Owner",
    mobile: "9000000001",
    email: null,
    lastLoginAt: null,
  },
  {
    id: IDS.user.staff,
    createdAt: t,
    updatedAt: t,
    name: "Booking staff",
    mobile: "9000000002",
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
  {
    id: IDS.user.accountant,
    createdAt: t,
    updatedAt: t,
    name: "Accountant",
    mobile: "9000000003",
    email: "accounts@example.com",
    lastLoginAt: null,
  },
];

/**
 * Mock logins until Supabase Auth: every sample user's password is this.
 * lib/data stores only a salted hash of it.
 */
export const MOCK_PASSWORD = "demo1234";

export const mockMemberships: Membership[] = [
  {
    id: IDS.membership.ownerAcm,
    companyId: IDS.company.acm,
    userId: IDS.user.owner,
    role: "owner",
    createdAt: t,
    updatedAt: t,
    version: 1,    createdBy: null,    updatedBy: null,
  },
  {
    id: IDS.membership.ownerRs,
    companyId: IDS.company.rs,
    userId: IDS.user.owner,
    role: "owner",
    createdAt: t,
    updatedAt: t,
    version: 1,    createdBy: null,    updatedBy: null,
  },
  {
    id: IDS.membership.staffAcm,
    companyId: IDS.company.acm,
    userId: IDS.user.staff,
    role: "booking_staff",
    createdAt: t,
    updatedAt: t,
    version: 1,    createdBy: null,    updatedBy: null,
  },
  {
    id: IDS.membership.accountantAcm,
    companyId: IDS.company.acm,
    userId: IDS.user.accountant,
    role: "accountant",
    createdAt: t,
    updatedAt: t,
    version: 1,    createdBy: null,    updatedBy: null,
  },
  {
    id: IDS.membership.driverAcm,
    companyId: IDS.company.acm,
    userId: IDS.user.driver,
    role: "driver",
    createdAt: t,
    updatedAt: t,
    version: 1,    createdBy: null,    updatedBy: null,
  },
];
