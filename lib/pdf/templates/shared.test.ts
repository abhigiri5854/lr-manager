import { describe, expect, it } from "vitest";
import { esc, fileSafe, htmlDocument, multiline } from "./shared";

describe("pdf shared helpers", () => {
  it("escapes HTML from the database", () => {
    expect(esc(`<b>"A" & 'B'</b>`)).toBe("&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;");
    expect(esc(null)).toBe("");
  });

  it("keeps line breaks in free text", () => {
    expect(multiline("a <b>\nc")).toBe("a &lt;b&gt;<br>c");
    expect(multiline(null)).toBe("");
  });

  it("builds portrait pages with the fonts embedded and a DRAFT mark", () => {
    const html = htmlDocument({ title: "LR 1", mark: "DRAFT", body: "<p>x</p>" });
    expect(html).toContain("@page{size:A4;");
    expect(html).toContain('<div class="wm wm-mark">DRAFT</div>');
    expect(html).toContain("font-family:'Noto Sans Devanagari'");
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).not.toContain('class="wm wm-logo"');
  });

  it("builds landscape pages with a logo watermark and no mark", () => {
    const html = htmlDocument({
      title: "FB",
      landscape: true,
      watermarkSrc: "data:image/png;base64,AAAA",
      body: "",
    });
    expect(html).toContain("@page{size:A4 landscape;");
    expect(html).toContain('class="wm wm-logo" src="data:image/png;base64,AAAA"');
       expect(html).not.toContain('class="wm wm-mark"');
  });

  it("makes safe file names", () => {
    expect(fileSafe("ACM/FB/26-27/001")).toBe("ACM-FB-26-27-001");
    expect(fileSafe("19021")).toBe("19021");
  });
});
