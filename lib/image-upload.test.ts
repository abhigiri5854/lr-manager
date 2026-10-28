import { describe, expect, it } from "vitest";
import { formatFileSize, prepareUpload, tooBigMessage, UPLOAD_MAX_BYTES } from "./image-upload";

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

describe("prepareUpload size limits", () => {
  const pdf = (mb: number) =>
    new File([new Uint8Array(mb * 1024 * 1024)], "scan.pdf", { type: "application/pdf" });

  it("keeps the 3 MB server-action limit by default", async () => {
    expect(await prepareUpload(pdf(2))).toMatchObject({ ok: true });
    expect(await prepareUpload(pdf(4))).toMatchObject({ ok: false });
  });

  it("lets a route-handler upload (Smart import) go up to its own limit", async () => {
    const ten = 10 * 1024 * 1024;
    expect(await prepareUpload(pdf(9), { maxBytes: ten, requestLimit: ten })).toMatchObject({
      ok: true,
    });
    const tooBig = await prepareUpload(pdf(11), { maxBytes: ten, requestLimit: ten });
    expect(tooBig).toMatchObject({ ok: false });
    expect(tooBig.ok ? "" : tooBig.message).toMatch(/limit is 10\.0 MB/);
  });
});
