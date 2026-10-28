import { describe, expect, it } from "vitest";
import {
  can,
  deniedMessage,
  PERMISSION_ROWS,
  permissionCell,
  PERMISSIONS,
  ROLES as ALL_ROLES,
  type Action,
} from "./permissions";
import type { Role } from "./types";

// The table "What each role can do" in design/screens/Users.dc.html, row by row.
// Columns: Owner, Accountant, Booking staff, Driver ("✓ own trips" = pod.upload_own).
const DESIGN_TABLE: Array<[string, Action, [boolean, boolean, boolean, boolean]]> = [
  ["Create / edit LR", "lr.edit", [true, false, true, false]],
  ["Tax invoices", "invoice.edit", [true, true, true, false]],
  ["Freight bills & payments", "bill.edit", [true, true, false, false]],
  ["Delete or cancel records", "record.cancel", [true, false, false, false]],
  ["Company profile & users", "company.manage", [true, false, false, false]],
  ["Smart import", "import.run", [true, true, true, false]],
  ["Upload POD photo", "pod.upload", [true, false, true, false]],
  ["Upload POD photo (own trips)", "pod.upload_own", [false, false, false, true]],
  ["See freight amounts", "freight.view", [true, true, true, false]],
];
const ROLES: Role[] = ["owner", "accountant", "booking_staff", "driver"];

describe("PERMISSIONS", () => {
  it.each(DESIGN_TABLE)("%s matches the Users & roles table", (_row, action, expected) => {
    expect(ROLES.map((r) => can(r, action))).toEqual(expected);
  });

  it("gives masters (parties, trucks, items) to office roles only", () => {
    expect(ROLES.map((r) => can(r, "master.edit"))).toEqual([true, true, true, false]);
  });

  it("has no action outside the table plus master.edit", () => {
    const known = new Set<Action>([...DESIGN_TABLE.map((r) => r[1]), "master.edit"]);
    for (const role of ROLES) for (const a of PERMISSIONS[role]) expect(known).toContain(a);
  });

  it("Users & roles table: the design's rows and cells, plus Parties, trucks & items", () => {
    const rendered = PERMISSION_ROWS.map((row) => [
      row.label,
      ...ALL_ROLES.map((r) => permissionCell(r, row)),
    ]);
    expect(rendered).toEqual([
      ["Create / edit LR", "✓", "—", "✓", "—"],
      ["Tax invoices", "✓", "✓", "✓", "—"],
      ["Freight bills & payments", "✓", "✓", "—", "—"],
      ["Delete or cancel records", "✓", "—", "—", "—"],
      ["Company profile & users", "✓", "—", "—", "—"],
      ["Smart import", "✓", "✓", "✓", "—"],
      ["Upload POD photo", "✓", "—", "✓", "✓ own trips"],
      ["See freight amounts", "✓", "✓", "✓", "—"],
      ["Parties, trucks & items", "✓", "✓", "✓", "—"],
    ]);
  });

  it("puts every action somewhere in that table", () => {
    const shown = new Set(PERMISSION_ROWS.flatMap((r) => [r.action, r.partial?.action]));
    for (const role of ALL_ROLES) for (const a of PERMISSIONS[role]) expect(shown).toContain(a);
  });

  it("denies everything without a role", () => {
    expect(can(null, "lr.edit")).toBe(false);
    expect(can(undefined, "freight.view")).toBe(false);
  });

  it("explains a refusal", () => {
    expect(deniedMessage("accountant", "lr.edit")).toBe(
      "Your role (Accountant) can't create or edit LRs.",
    );
    expect(deniedMessage(null, "lr.edit")).toBe("You're not a member of this company.");
  });
});
