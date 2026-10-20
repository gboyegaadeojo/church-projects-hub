import { createElement, Fragment, type ReactNode } from "react";
import { isSafeHref, type RichTextDoc, type RichTextNode } from "../../../shared/richtext";

// Read-only rendering of stored Tiptap JSON (section 11.5). It builds React elements for the allowed nodes and
// marks only; anything else is skipped. No raw HTML is ever inserted, and links are re-checked before render.

function renderMarks(text: string, marks: RichTextNode["marks"], key: number): ReactNode {
  let out: ReactNode = text;
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
        out = <strong>{out}</strong>;
        break;
      case "italic":
        out = <em>{out}</em>;
        break;
      case "underline":
        out = <u>{out}</u>;
        break;
      case "strike":
        out = <s>{out}</s>;
        break;
      case "code":
        out = <code className="rounded-chip bg-hover px-1 font-mono text-[0.9em]">{out}</code>;
        break;
      case "link": {
        const href = mark.attrs?.href;
        if (isSafeHref(href)) {
          out = (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-ink underline underline-offset-4">
              {out}
            </a>
          );
        }
        break;
      }
    }
  }
  return <Fragment key={key}>{out}</Fragment>;
}

const BLOCK: Record<string, { tag: string; className?: string }> = {
  paragraph: { tag: "p" },
  bulletList: { tag: "ul", className: "list-disc pl-6" },
  orderedList: { tag: "ol", className: "list-decimal pl-6" },
  listItem: { tag: "li" },
  blockquote: { tag: "blockquote", className: "border-l-4 border-line-strong pl-3 text-ink-2" },
};

function renderNode(node: RichTextNode, key: number): ReactNode {
  const children = () => (node.content ?? []).map((c, i) => renderNode(c, i));
  switch (node.type) {
    case "text":
      return renderMarks(node.text ?? "", node.marks, key);
    case "hardBreak":
      return <br key={key} />;
    case "mention":
      return (
        <span key={key} className="rounded-chip bg-accent-soft px-1 font-medium text-accent-ink">
          @{String(node.attrs?.label ?? "")}
        </span>
      );
    case "heading":
      return createElement(node.attrs?.level === 3 ? "h4" : "h3", { key, className: "text-body font-semibold text-ink" }, children());
    case "codeBlock":
      return (
        <pre key={key} className="overflow-x-auto rounded-control bg-hover p-3 font-mono text-caption">
          <code>{children()}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} className="border-line" />;
    default: {
      const block = BLOCK[node.type];
      return block ? createElement(block.tag, { key, className: block.className }, children()) : null;
    }
  }
}

export function RichTextView({ doc, className }: { doc: RichTextDoc; className?: string }) {
  return <div className={className ?? "flex flex-col gap-2 text-body text-ink break-words"}>{(doc.content ?? []).map((n, i) => renderNode(n, i))}</div>;
}

export function isEmptyDoc(doc: RichTextDoc): boolean {
  return !(doc.content ?? []).some((n) => n.type !== "paragraph" || (n.content ?? []).length > 0);
}
