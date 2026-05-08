import { describe, it, expect } from "vitest";

import { snippet, stripHtml } from "./html.js";

describe("stripHtml", () => {
  it("returns empty for empty input", () => {
    expect(stripHtml("")).toBe("");
  });

  it("strips simple tags and collapses whitespace", () => {
    expect(stripHtml("<p>Hello   <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes character entities", () => {
    expect(stripHtml("<p>tea &amp; biscuits</p>")).toBe("tea & biscuits");
  });

  it("handles multiline blocks", () => {
    const out = stripHtml("<p>Line 1</p>\n<p>Line 2</p>");
    expect(out).toBe("Line 1 Line 2");
  });
});

describe("snippet", () => {
  const text = "The quick brown fox jumps over the lazy dog and then keeps running.";

  it("centers the snippet around the match index", () => {
    const idx = text.indexOf("fox");
    const out = snippet(text, idx, 10);
    expect(out).toContain("fox");
    expect(out.startsWith("…")).toBe(true);
  });

  it("omits leading ellipsis when at the start", () => {
    const out = snippet("hello world", 0, 5);
    expect(out.startsWith("…")).toBe(false);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns full text when shorter than radius", () => {
    expect(snippet("hi", 0, 80)).toBe("hi");
  });
});
