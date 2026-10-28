import { describe, expect, it } from "vitest";
import { formatFileSize, tooBigMessage, UPLOAD_MAX_BYTES } from "./image-upload";

describe("upload size messages", () => {
  it("formats sizes", () => {
    expect(formatFileSize(6 * 1024 * 1024)).toBe("6.0 MB");
    expect(formatFileSize(512_000)).toBe("500 KB");
    expect(formatFileSize(10)).toBe("1 KB");
  });

  it("explains what to do with a large PDF", () => {
    const msg = tooBigMessage(
      { name: "scan.pdf", size: 5 * 1024 * 1024, type: "application/pdf" },
      UPLOAD_MAX_BYTES,
    );
    expect(msg).toBe(
      "scan.pdf is 5.0 MB — the limit is 3.0 MB. Save a smaller PDF (scan at lower quality or fewer pages), or upload photos of the pages instead.",
    );
  });
});
