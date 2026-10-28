import { beforeEach, describe, expect, it } from "vitest";
import { setTestUser } from "@/lib/test-setup";
import { db, resetStore, SAMPLE_IDS } from "./_store";
import { inviteMember, listMemberRows, resetMemberPassword } from "./members";
import {
  getActiveCompanyId,
  getSessionUserId,
  LOGIN_FAILED,
  logIn,
  logOut,
  sessionCookieValue,
} from "./session";

const PASSWORD = "demo1234"; // lib/mock/users.ts MOCK_PASSWORD
const acmId = () => db.companies.find((c) => c.label === "ACM Logistics")!.id;
const userByName = (name: string) => db.users.find((u) => u.name === name)!;

beforeEach(async () => {
  resetStore();
  await setTestUser(null);
});

describe("logIn", () => {
  it("accepts a mobile in any common format, or the email", async () => {
    expect(await logIn("+91 90000 00001", PASSWORD)).toEqual({ ok: true, home: "/" });
    expect(await getSessionUserId()).toBe(SAMPLE_IDS.ownerId);
    expect(userByName("Owner").lastLoginAt).not.toBeNull();

    await setTestUser(null);
    expect(await logIn("Accounts@Example.com", PASSWORD)).toMatchObject({ ok: true });
    expect(await getSessionUserId()).toBe(userByName("Accountant").id);
  });

  it("gives the same message for an unknown user and a wrong password", async () => {
    expect(await logIn("9999999999", PASSWORD)).toEqual({ ok: false, message: LOGIN_FAILED });
    expect(await logIn("9000000001", "wrong")).toEqual({ ok: false, message: LOGIN_FAILED });
    expect(await getSessionUserId()).toBeNull();
  });

  it("sends drivers to My trips", async () => {
    expect(await logIn("7870015869", PASSWORD)).toEqual({ ok: true, home: "/driver" });
  });

  it("refuses someone with no company left", async () => {
    for (const m of db.memberships.filter((x) => x.userId === userByName("Accountant").id)) {
      m.cancelledAt = "2026-10-01T00:00:00.000Z";
    }
    expect(await logIn("9000000003", PASSWORD)).toMatchObject({ ok: false });
  });
});

describe("session cookie", () => {
  it("rejects a forged or tampered cookie", async () => {
    const real = sessionCookieValue(SAMPLE_IDS.ownerId);
    expect(real.startsWith(`${SAMPLE_IDS.ownerId}.`)).toBe(true);
    // Another user's id with the owner's signature.
    const forged = `${userByName("Accountant").id}.${real.split(".")[1]}`;
    const { cookies } = await import("next/headers");
    (await cookies()).set("lrm_session", forged);
    expect(await getSessionUserId()).toBeNull();
  });

  it("logs out", async () => {
    await setTestUser(SAMPLE_IDS.ownerId);
    expect(await getActiveCompanyId()).toBe(acmId());
    await logOut();
    expect(await getSessionUserId()).toBeNull();
    await expect(getActiveCompanyId()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("inviteMember", () => {
  beforeEach(() => setTestUser(SAMPLE_IDS.ownerId));

  it("creates a login with a one-time password for someone new", async () => {
    const r = await inviteMember(acmId(), {
      name: "New Clerk",
      mobile: "98765 43210",
      email: "",
      role: "booking_staff",
    });
    expect(r.tempPassword).toMatch(/^[a-z2-9]{10}$/);
    expect(r.membership.role).toBe("booking_staff");
    await setTestUser(null);
    expect(await logIn("9876543210", r.tempPassword!)).toEqual({ ok: true, home: "/" });
  });

  it("adds an existing login to the company without a new password", async () => {
    const rsId = db.companies.find((c) => c.label === "RS Logistics")!.id;
    const r = await inviteMember(rsId, {
      name: "Ignored",
      mobile: "9000000003",
      role: "accountant",
    });
    expect(r.tempPassword).toBeNull();
    expect(r.membership.userId).toBe(userByName("Accountant").id);
  });

  it("refuses duplicates and driver role", async () => {
    await expect(
      inviteMember(acmId(), { name: "X", mobile: "9000000002", role: "accountant" }),
    ).rejects.toThrow(/already in this company/);
    await expect(
      inviteMember(acmId(), { name: "X", mobile: "9876543211", role: "driver" as never }),
    ).rejects.toThrow();
  });
});

describe("listMemberRows", () => {
  it("lists members, Owners first, with the companies shared with the viewer", async () => {
    await setTestUser(SAMPLE_IDS.ownerId);
    const rows = await listMemberRows(acmId());
    expect(rows.map((r) => r.role)).toEqual(["owner", "accountant", "booking_staff", "driver"]);
    expect(rows[0]).toMatchObject({ isMe: true, companies: ["ACM Logistics", "RS Logistics"] });
    expect(rows[2]).toMatchObject({ isMe: false, companies: ["ACM Logistics"] });
  });
});

describe("resetMemberPassword", () => {
  it("gives a new one-time password the member can log in with", async () => {
    await setTestUser(SAMPLE_IDS.ownerId);
    const staff = db.memberships.find((m) => m.role === "booking_staff")!;
    const { tempPassword } = await resetMemberPassword(acmId(), staff.id);
    await setTestUser(null);
    expect(await logIn("9000000002", PASSWORD)).toMatchObject({ ok: false });
    expect(await logIn("9000000002", tempPassword)).toMatchObject({ ok: true });
  });

  it("won't reset someone who also works for a company the Owner doesn't own", async () => {
    await setTestUser(SAMPLE_IDS.ownerId);
    // The accountant also joins a company where the sample Owner is not a member.
    const other = { ...db.companies[0], id: "00000000-0000-4000-8000-00000000abcd", gstin: "X" };
    db.companies.push(other);
    const acc = db.memberships.find((m) => m.role === "accountant")!;
    db.memberships.push({
      ...acc,
      id: "00000000-0000-4000-8000-00000000abce",
      companyId: other.id,
    });
    await expect(resetMemberPassword(acmId(), acc.id)).rejects.toThrow(/don't own/);
  });
});
