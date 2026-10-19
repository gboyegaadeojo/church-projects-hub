import { describe, expect, it } from "vitest";
import { docFromText, parseRichText } from "../shared/richtext";

// Section 11.5 / NFR-3: rich text is validated Tiptap JSON, never HTML.

const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("Section 11.5 rich text storage and safety", () => {
  it("accepts the description nodes and marks and writes a plain-text copy", () => {
    const input = doc(
      { type: "heading", attrs: { level: 2 }, content: [t("Sound check")] },
      p(t("Bring "), t("spare", [{ type: "bold" }]), t(" batteries.")),
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("Mic 1"))] }] },
      { type: "codeBlock", attrs: { language: "text" }, content: [t("gain 40")] },
      { type: "horizontalRule" },
      p(t("Docs", [{ type: "link", attrs: { href: "https://example.org", target: "_blank" } }])),
    );
    const result = parseRichText(input, "description");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe("Sound check\nBring spare batteries.\nMic 1\ngain 40\n\nDocs");
    // Unknown attributes (target) are dropped.
    expect(JSON.stringify(result.value.doc)).not.toContain("_blank");
  });

  it("rejects links that aren't http, https or mailto", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,hi", "vbscript:x", "/relative", "not a url"]) {
      const result = parseRichText(doc(p(t("x", [{ type: "link", attrs: { href } }]))), "description");
      expect(result.ok, href).toBe(false);
    }
    expect(parseRichText(doc(p(t("x", [{ type: "link", attrs: { href: "mailto:media@example.org" } }]))), "description").ok).toBe(true);
  });

  it("rejects nodes outside the allowed list, including raw HTML", () => {
    for (const node of [{ type: "html", attrs: { html: "<script>" } }, { type: "image", attrs: { src: "https://x" } }, { type: "iframe" }]) {
      expect(parseRichText(doc(node), "description").ok).toBe(false);
    }
    expect(parseRichText("<p>hi</p>", "description").ok).toBe(false);
    expect(parseRichText(null, "description").ok).toBe(false);
  });

  it("comments allow fewer formats: no headings, fenced code or numbered lists", () => {
    expect(parseRichText(doc({ type: "heading", attrs: { level: 2 }, content: [t("x")] }), "comment").ok).toBe(false);
    expect(parseRichText(doc({ type: "codeBlock", content: [t("x")] }), "comment").ok).toBe(false);
    expect(parseRichText(doc({ type: "orderedList", content: [] }), "comment").ok).toBe(false);
    expect(parseRichText(doc(p(t("x", [{ type: "underline" }]))), "comment").ok).toBe(false);
    expect(parseRichText(doc(p(t("x", [{ type: "italic" }, { type: "code" }]))), "comment").ok).toBe(true);
  });

  it("collects @mentions and shows them as @name in the text", () => {
    const result = parseRichText(doc(p(t("Thanks "), { type: "mention", attrs: { id: "7", label: "Sam" } }, t("!"))), "comment");
    expect(result.ok && result.value.mentions).toEqual([7]);
    expect(result.ok && result.value.text).toBe("Thanks @Sam!");
    expect(parseRichText(doc(p({ type: "mention", attrs: { id: "x", label: "Sam" } })), "comment").ok).toBe(false);
  });

  it("limits size and nesting", () => {
    expect(parseRichText(doc(p(t("a".repeat(120_000)))), "description").ok).toBe(false);
    let deep: unknown = p(t("x"));
    for (let i = 0; i < 20; i++) deep = { type: "blockquote", content: [deep] };
    expect(parseRichText(doc(deep), "description").ok).toBe(false);
  });

  it("docFromText makes paragraphs", () => {
    const result = parseRichText(docFromText("One\n\nTwo"), "description");
    expect(result.ok && result.value.text).toBe("One\nTwo");
  });
});
