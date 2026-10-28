import { describe, expect, it } from "vitest";
import { read, utils } from "xlsx";
import { listLrsForExport } from "@/lib/data/lrs";
import { db } from "@/lib/data/_store";
import { lrRegisterWorkbook } from "./lr-register-xlsx";

describe("LR register Excel export", () => {
  it("writes one row per LR with real dates and amounts", async () => {
    const companyId = db.companies.find((c) => c.label === "ACM Logistics")!.id;
    const { rows } = await listLrsForExport(companyId);
    const book = read(lrRegisterWorkbook(rows));
    const sheet = book.Sheets["LR register"];
    const data = utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false });
    expect(data).toHaveLength(2);
    const lr = data.find((r) => r["LR No"] === "19019")!;
    expect(lr["LR date"]).toBe("14-10-2026");
    expect(lr["Value (₹)"]).toBe("1,79,356.00");
    expect(lr["Pay mode"]).toBe("TBB");
  });
});
