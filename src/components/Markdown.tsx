import { Fragment, useMemo } from "react";
import { type Inline, parseMarkdown } from "../../shared/markdown";

// Renders What's New Markdown (section 11.9) as React elements; never as HTML.

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text":
            return <Fragment key={i}>{n.text}</Fragment>;
          case "bold":
            return (
              <strong key={i} className="font-semibold text-ink">
                <Inlines nodes={n.children} />
              </strong>
            );
          case "italic":
            return (
              <em key={i}>
                <Inlines nodes={n.children} />
              </em>
            );
          case "link": {
            const external = !n.href.startsWith("/");
            return (
              <a
                key={i}
                href={n.href}
                className="font-medium text-accent-ink underline"
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                <Inlines nodes={n.children} />
              </a>
            );
          }
        }
      })}
    </>
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="flex flex-col gap-3 text-body text-ink-2">
      {blocks.map((b, i) =>
        b.type === "paragraph" ? (
          <p key={i}>
            <Inlines nodes={b.children} />
          </p>
        ) : b.ordered ? (
          <ol key={i} className="flex list-decimal flex-col gap-1 pl-6">
            {b.items.map((item, j) => (
              <li key={j}>
                <Inlines nodes={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-6">
            {b.items.map((item, j) => (
              <li key={j}>
                <Inlines nodes={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
