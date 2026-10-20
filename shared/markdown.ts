// The Markdown What's New posts use (section 11.9): paragraphs, bullet and numbered lists, **bold**, *italic*
// and [links](https://…). It parses to a small tree that the app renders as elements — raw HTML is never
// interpreted (section 6: "rendered with raw HTML disabled"); anything else shows as plain text.

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

/** Only web, mail and in-app links; javascript: and the like stay as text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\/[^\s]+$/i.test(h) || /^mailto:[^\s]+$/i.test(h)) return h;
  if (/^\/(?!\/)[^\s]*$/.test(h)) return h;
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const bold = /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest);
    if (bold) {
      flush();
      out.push({ type: "bold", children: parseInline(bold[1]!) });
      i += bold[0].length;
      continue;
    }
    const italic = /^[*_](?=\S)([^*_]*?\S)[*_]/.exec(rest);
    if (italic && rest[0] === italic[0].at(-1)) {
      flush();
      out.push({ type: "italic", children: parseInline(italic[1]!) });
      i += italic[0].length;
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = safeHref(link[2]!);
      if (href) {
        flush();
        out.push({ type: "link", href, children: parseInline(link[1]!) });
      } else {
        text += link[1];
      }
      i += link[0].length;
      continue;
    }
    text += src[i];
    i += 1;
  }
  flush();
  return out;
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const endList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    list = null;
  };
  for (const line of lines) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      endParagraph();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) endList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else if (line.trim() === "") {
      endParagraph();
      endList();
    } else if (list && /^\s{2,}\S/.test(line)) {
      // An indented line continues the list item above.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      endList();
      paragraph.push(line.trim());
    }
  }
  endParagraph();
  endList();
  return blocks;
}
