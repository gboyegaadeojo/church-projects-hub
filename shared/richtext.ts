import { z } from "zod";

// Rich text (section 11.5, NFR-3): task descriptions and comments are Tiptap JSON, never HTML.
// The server accepts only the nodes and marks listed here, only http/https/mailto links, and keeps a
// plain-text copy for search and emails. The client renders the JSON with Tiptap, so no raw HTML is
// ever inserted into the page.

export type RichTextKind = "description" | "comment";

const DESCRIPTION_NODES = new Set([
  "doc",
  "paragraph",
  "text",
  "hardBreak",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "mention",
]);
const COMMENT_NODES = new Set(["doc", "paragraph", "text", "hardBreak", "bulletList", "listItem", "mention"]);
const DESCRIPTION_MARKS = new Set(["bold", "italic", "underline", "strike", "code", "link"]);
const COMMENT_MARKS = new Set(["bold", "italic", "code", "link"]);

export const RICH_TEXT_LIMITS = {
  /** Serialized JSON size. Generous for a long description, small enough for the 10 ms CPU budget. */
  maxBytes: 100_000,
  maxDepth: 12,
  /** Plain-text length after extraction. */
  maxText: 20_000,
} as const;

const LINK_SCHEMES = ["http:", "https:", "mailto:"];

export function isSafeHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length > 2000) return false;
  try {
    return LINK_SCHEMES.includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

export type RichTextNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};
export type RichTextDoc = { type: "doc"; content?: RichTextNode[] };

/** Allowed attributes per node or mark; anything else is dropped. Values are checked where they matter. */
function cleanAttrs(type: string, attrs: unknown): Record<string, unknown> | undefined | false {
  const a = (attrs && typeof attrs === "object" ? attrs : {}) as Record<string, unknown>;
  switch (type) {
    case "heading":
      return a.level === 2 || a.level === 3 ? { level: a.level } : false;
    case "orderedList":
      return { start: Number.isInteger(a.start) && (a.start as number) > 0 ? a.start : 1 };
    case "codeBlock":
      return typeof a.language === "string" && /^[\w+-]{1,20}$/.test(a.language) ? { language: a.language } : undefined;
    case "mention":
      return Number.isSafeInteger(Number(a.id)) && Number(a.id) > 0 && typeof a.label === "string" && a.label.length <= 100
        ? { id: String(a.id), label: a.label }
        : false;
    case "link":
      return isSafeHref(a.href) ? { href: a.href } : false;
    default:
      return undefined;
  }
}

type Walk = { nodes: Set<string>; marks: Set<string>; issues: string[]; text: string[]; mentions: Set<number> };

// Containers (lists, list items, quotes) hold paragraphs, which already end their own line.
const BLOCKS_WITH_BREAK = new Set(["paragraph", "heading", "codeBlock", "horizontalRule"]);

function walk(node: unknown, w: Walk, depth: number): RichTextNode | null {
  if (depth > RICH_TEXT_LIMITS.maxDepth) {
    w.issues.push("Too deeply nested.");
    return null;
  }
  if (!node || typeof node !== "object" || typeof (node as RichTextNode).type !== "string") {
    w.issues.push("Not a rich text node.");
    return null;
  }
  const n = node as RichTextNode;
  if (!w.nodes.has(n.type) || (depth > 0 && n.type === "doc")) {
    w.issues.push(`"${n.type}" isn't allowed here.`);
    return null;
  }
  const out: RichTextNode = { type: n.type };
  const attrs = cleanAttrs(n.type, n.attrs);
  if (attrs === false) {
    w.issues.push(`"${n.type}" has invalid attributes.`);
    return null;
  }
  if (attrs) out.attrs = attrs;

  if (n.type === "text") {
    if (typeof n.text !== "string" || n.text.length === 0) {
      w.issues.push("Empty text node.");
      return null;
    }
    out.text = n.text;
    w.text.push(n.text);
    if (n.marks !== undefined) {
      if (!Array.isArray(n.marks)) {
        w.issues.push("Invalid marks.");
        return null;
      }
      out.marks = [];
      for (const m of n.marks) {
        if (!m || typeof m !== "object" || !w.marks.has(m.type)) {
          w.issues.push(`Formatting "${m?.type}" isn't allowed here.`);
          return null;
        }
        const markAttrs = cleanAttrs(m.type, m.attrs);
        if (markAttrs === false) {
          w.issues.push(m.type === "link" ? "Links must start with http, https or mailto." : "Invalid formatting.");
          return null;
        }
        out.marks.push(markAttrs ? { type: m.type, attrs: markAttrs } : { type: m.type });
      }
      if (out.marks.length === 0) delete out.marks;
    }
    return out;
  }
  if (n.type === "mention") {
    w.text.push(`@${out.attrs!.label as string}`);
    w.mentions.add(Number(out.attrs!.id));
    return out;
  }
  if (n.type === "hardBreak") {
    w.text.push("\n");
    return out;
  }
  if (n.content !== undefined) {
    if (!Array.isArray(n.content)) {
      w.issues.push("Invalid content.");
      return null;
    }
    out.content = [];
    for (const child of n.content) {
      const c = walk(child, w, depth + 1);
      if (!c) return null;
      out.content.push(c);
    }
  }
  if (BLOCKS_WITH_BREAK.has(n.type)) w.text.push("\n");
  return out;
}

export type ParsedRichText = { doc: RichTextDoc; text: string; mentions: number[] };

/** Validates Tiptap JSON for a description or comment. Returns the cleaned doc, plain text and mentioned user ids. */
export function parseRichText(input: unknown, kind: RichTextKind): { ok: true; value: ParsedRichText } | { ok: false; issues: string[] } {
  const w: Walk = {
    nodes: kind === "description" ? DESCRIPTION_NODES : COMMENT_NODES,
    marks: kind === "description" ? DESCRIPTION_MARKS : COMMENT_MARKS,
    issues: [],
    text: [],
    mentions: new Set(),
  };
  let size = 0;
  try {
    size = JSON.stringify(input ?? null).length;
  } catch {
    return { ok: false, issues: ["Not valid rich text."] };
  }
  if (size > RICH_TEXT_LIMITS.maxBytes) return { ok: false, issues: ["This is too long. Shorten it and try again."] };
  if (!input || typeof input !== "object" || (input as RichTextNode).type !== "doc") {
    return { ok: false, issues: ["Not valid rich text."] };
  }
  const doc = walk(input, w, 0);
  if (!doc || w.issues.length > 0) return { ok: false, issues: w.issues.length ? w.issues : ["Not valid rich text."] };
  const text = w.text
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > RICH_TEXT_LIMITS.maxText) return { ok: false, issues: ["This is too long. Shorten it and try again."] };
  return { ok: true, value: { doc: doc as RichTextDoc, text, mentions: [...w.mentions] } };
}

/** Zod schema that validates and normalises rich text; use `.transform` output on the server. */
export function richText(kind: RichTextKind) {
  return z.unknown().transform((input, ctx) => {
    const result = parseRichText(input, kind);
    if (!result.ok) {
      for (const message of result.issues) ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return result.value;
  });
}

/** An empty document, e.g. a task created without a description. */
export const EMPTY_DOC: RichTextDoc = { type: "doc", content: [] };

/** A document holding plain text paragraphs (used for quick-created tasks and tests). */
export function docFromText(text: string): RichTextDoc {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
  };
}
