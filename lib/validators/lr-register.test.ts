import { describe, expect, it } from "vitest";
import {
  hasLrFilters,
  lrRegisterSearch,
  lrStatusSlug,
  parseLrRegisterQuery,
  toLrListParams,
} from "./lr-register";

describe("LR register query", () => {
  it("reads filters from the URL", () => {
    const q = parseLrRegisterQuery(
      new URLSearchParams("q=+19019+&from=2026-10-01&to=2026-10-31&status=in-transit&page=3"),
    );
    expect(q).toEqual({
      q: "19019",
      from: "2026-10-01",
      to: "2026-10-31",
      party: undefined,
      truck: undefined,
      status: "in-transit",
      page: 3,
    });
    expect(toLrListParams(q).status).toBe("In transit");
    expect(hasLrFilters(q)).toBe(true);
  });

  it("drops bad values instead of failing", () => {
    const q = parseLrRegisterQuery({ from: "14-10-2026", status: "nope", page: "-2", q: "  " });
    expect(q).toMatchObject({ from: undefined, status: undefined, page: 1, q: undefined });
    expect(hasLrFilters(q)).toBe(false);
  });

  it("takes the first of repeated params", () => {
    expect(parseLrRegisterQuery({ party: ["a", "b"] }).party).toBe("a");
  });

  it("builds a query string without empty values or page 1", () => {
    expect(lrRegisterSearch({ q: "BR01", status: "", page: 1 })).toBe("?q=BR01");
    expect(lrRegisterSearch({ page: 2, truck: "t1" })).toBe("?truck=t1&page=2");
    expect(lrRegisterSearch({})).toBe("");
  });

  it("round-trips status slugs", () => {
    expect(lrStatusSlug("POD received")).toBe("pod-received");
  });
});
