import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  formatDateTyping,
  formatTimeTyping,
  isoToDisplay,
  monthWeeks,
  parseDisplayDate,
  parseTime,
  weekdayIndex,
} from "./date-input";

describe("parseDisplayDate", () => {
  it("reads dd-mm-yyyy", () => {
    expect(parseDisplayDate("28-10-2026")).toEqual({ ok: true, iso: "2026-10-28" });
  });
  it("reads dd/mm/yyyy and dd.mm.yyyy", () => {
    expect(parseDisplayDate("28/10/2026")).toEqual({ ok: true, iso: "2026-10-28" });
    expect(parseDisplayDate("28.10.2026")).toEqual({ ok: true, iso: "2026-10-28" });
  });
  it("pads a single-digit day and month", () => {
    expect(parseDisplayDate("1/2/2026")).toEqual({ ok: true, iso: "2026-02-01" });
  });
  it("rejects a space where a separator should be", () => {
    expect(parseDisplayDate("2810 2026").ok).toBe(false);
  });
  it("rejects a day that doesn't exist", () => {
    expect(parseDisplayDate("31-02-2026")).toEqual({ ok: false, error: "Not a real date" });
    expect(parseDisplayDate("29-02-2027").ok).toBe(false);
  });
  it("accepts 29 February in a leap year", () => {
    expect(parseDisplayDate("29-02-2028")).toEqual({ ok: true, iso: "2028-02-29" });
  });
  it("rejects month 13, day 0, short years and empty text", () => {
    for (const bad of ["10-13-2026", "00-10-2026", "28-10-26", "", "ab-cd-efgh"]) {
      expect(parseDisplayDate(bad).ok).toBe(false);
    }
  });
});

describe("isoToDisplay", () => {
  it("flips to dd-mm-yyyy and ignores junk", () => {
    expect(isoToDisplay("2026-10-28")).toBe("28-10-2026");
    expect(isoToDisplay("")).toBe("");
    expect(isoToDisplay("28-10-2026")).toBe("");
  });
});

describe("formatDateTyping", () => {
  it("adds the dashes as digits are typed", () => {
    expect(formatDateTyping("2")).toBe("2");
    expect(formatDateTyping("28", "2")).toBe("28-");
    expect(formatDateTyping("28-1", "28-")).toBe("28-1");
    expect(formatDateTyping("28-10", "28-1")).toBe("28-10-");
    expect(formatDateTyping("28-10-2", "28-10-")).toBe("28-10-2");
    expect(formatDateTyping("28-10-20269", "28-10-2026")).toBe("28-10-2026");
  });
  it("lets backspace remove a dash instead of re-adding it", () => {
    expect(formatDateTyping("28", "28-")).toBe("28");
    expect(formatDateTyping("28-10", "28-10-")).toBe("28-10");
  });
  it("formats a paste of plain digits", () => {
    expect(formatDateTyping("28102026")).toBe("28-10-2026");
  });
  it("turns slashes into dashes and pads short parts", () => {
    expect(formatDateTyping("28/10/2026")).toBe("28-10-2026");
    expect(formatDateTyping("1/2/2026")).toBe("01-02-2026");
    expect(formatDateTyping("1/")).toBe("01-");
  });
  it("turns a pasted ISO date round", () => {
    expect(formatDateTyping("2026-10-28")).toBe("28-10-2026");
  });
  it("drops letters", () => {
    expect(formatDateTyping("2a8")).toBe("28-");
  });
});

describe("time", () => {
  it("parses 24-hour times", () => {
    expect(parseTime("14:30")).toEqual({ ok: true, time: "14:30" });
    expect(parseTime("9:05")).toEqual({ ok: true, time: "09:05" });
    expect(parseTime("24:00").ok).toBe(false);
    expect(parseTime("12:60").ok).toBe(false);
    expect(parseTime("1430").ok).toBe(false);
  });
  it("adds the colon while typing", () => {
    expect(formatTimeTyping("14", "1")).toBe("14:");
    expect(formatTimeTyping("14:3", "14:")).toBe("14:3");
    expect(formatTimeTyping("14", "14:")).toBe("14");
    expect(formatTimeTyping("1430")).toBe("14:30");
  });
});

describe("calendar maths", () => {
  it("moves by days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("moves by months, keeping to the month's last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
  it("starts weeks on Monday", () => {
    expect(weekdayIndex("2026-10-28")).toBe(2); // Wednesday
    const weeks = monthWeeks("2026-10-28");
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
  });
});
