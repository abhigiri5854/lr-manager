import { describe, expect, it } from "vitest";
import {
  checkImportBytes,
  checkImportFile,
  formatOf,
  IMPORT_MAX_BYTES,
  sniffMatches,
} from "./file-types";

const MB = 1024 * 1024;

describe("formatOf", () => {
  it("reads the extension, case-insensitively, and treats jpeg as jpg", () => {
    expect(formatOf("Report.XLSX")).toBe("xlsx");
    expect(formatOf("photo.jpeg")).toBe("jpg");
    expect(formatOf("invoice.PDF")).toBe("pdf");
    expect(formatOf("notes.txt")).toBeNull();
    expect(formatOf("noextension")).toBeNull();
  });
});

describe("checkImportFile", () => {
  it("accepts what each card takes and refuses the rest", () => {
    expect(checkImportFile({ name: "a.csv", size: 10 }, "excel")).toEqual({
      ok: true,
      format: "csv",
    });
    expect(checkImportFile({ name: "a.pdf", size: 10 }, "excel")).toMatchObject({ ok: false });
    expect(checkImportFile({ name: "a.pdf", size: 10 }, "document")).toEqual({
      ok: true,
      format: "pdf",
    });
    expect(checkImportFile({ name: "a.xlsx", size: 10 }, "document")).toEqual({
      ok: true,
      format: "xlsx",
    });
    expect(checkImportFile({ name: "a.csv", size: 10 }, "document")).toMatchObject({ ok: false });
    expect(checkImportFile({ name: "a.webp", size: 10 }, "document")).toMatchObject({ ok: false });
  });

  it("refuses empty and over-10-MB files with a plain message", () => {
    expect(checkImportFile({ name: "a.xlsx", size: 0 }, "excel")).toMatchObject({
      ok: false,
      message: "a.xlsx: the file is empty.",
    });
    const big = checkImportFile({ name: "scan.pdf", size: 11 * MB }, "document");
    expect(big).toMatchObject({ ok: false });
    expect(big.ok ? "" : big.message).toBe(
      "scan.pdf is 11.0 MB — the limit is 10 MB. Save a smaller PDF (scan at lower quality or fewer pages), or upload photos of the pages.",
    );
    expect(checkImportFile({ name: "a.pdf", size: IMPORT_MAX_BYTES }, "document")).toMatchObject({
      ok: true,
    });
  });
});

describe("sniffMatches", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  it("checks the first bytes", () => {
    expect(sniffMatches("pdf", bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(true);
    expect(sniffMatches("pdf", bytes(0x4d, 0x5a))).toBe(false); // an .exe
    expect(sniffMatches("xlsx", bytes(0x50, 0x4b, 3, 4))).toBe(true);
    expect(sniffMatches("xls", bytes(0xd0, 0xcf, 0x11, 0xe0))).toBe(true);
    expect(sniffMatches("png", bytes(0x89, 0x50, 0x4e, 0x47))).toBe(true);
    expect(sniffMatches("jpg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(sniffMatches("csv", new TextEncoder().encode("LR No,Date\n1,2"))).toBe(true);
    expect(sniffMatches("csv", bytes(0x50, 0x4b, 0, 0))).toBe(false);
  });

  it("checkImportBytes combines the name and the bytes", () => {
    const exe = { name: "invoice.pdf", bytes: bytes(0x4d, 0x5a, 0x90, 0) };
    expect(checkImportBytes(exe, "document")).toMatchObject({ ok: false });
    expect(
      checkImportBytes({ name: "invoice.pdf", bytes: bytes(0x25, 0x50, 0x44, 0x46) }, "document"),
    ).toEqual({ ok: true, format: "pdf" });
  });
});
