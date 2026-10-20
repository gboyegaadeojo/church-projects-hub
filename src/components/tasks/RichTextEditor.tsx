import Mention from "@tiptap/extension-mention";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Underline,
  type LucideIcon,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { isSafeHref, type RichTextDoc, type RichTextKind } from "../../../shared/richtext";
import type { Person } from "../../../shared/tasks";
import { cn } from "../../lib/cn";
import { fuzzyMatch } from "../../lib/fuzzy";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { TextInput } from "../ui/inputs";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/Menu";

// Rich text editor (section 11.5): Tiptap, storing JSON that the server validates. Descriptions get headings,
// lists, quotes, code and rules; comments only bold, italic, inline code, links, mentions and bullet lists.
// Accessibility: the toolbar is one Tab stop with arrow keys between tools; the editing area is a multi-line
// textbox; @mention suggestions are a listbox driven by aria-activedescendant.

type Tool = {
  key: string;
  label: string;
  icon: LucideIcon;
  kinds: RichTextKind[];
  run: (e: Editor) => void;
  active: (e: Editor) => boolean;
};

const TOOLS: Tool[] = [
  { key: "bold", label: "Bold", icon: Bold, kinds: ["description", "comment"], run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
  { key: "italic", label: "Italic", icon: Italic, kinds: ["description", "comment"], run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
  { key: "underline", label: "Underline", icon: Underline, kinds: ["description"], run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive("underline") },
  { key: "strike", label: "Strikethrough", icon: Strikethrough, kinds: ["description"], run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive("strike") },
  { key: "code", label: "Inline code", icon: Code, kinds: ["description", "comment"], run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive("code") },
  { key: "h2", label: "Heading", icon: Heading2, kinds: ["description"], run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
  { key: "h3", label: "Subheading", icon: Heading3, kinds: ["description"], run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  { key: "bullets", label: "Bulleted list", icon: List, kinds: ["description", "comment"], run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { key: "numbers", label: "Numbered list", icon: ListOrdered, kinds: ["description"], run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { key: "quote", label: "Quote", icon: Quote, kinds: ["description"], run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
  { key: "codeblock", label: "Code block", icon: SquareCode, kinds: ["description"], run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
  { key: "rule", label: "Divider", icon: Minus, kinds: ["description"], run: (e) => e.chain().focus().setHorizontalRule().run(), active: () => false },
];

export { fuzzyMatch };

type SuggestState = { items: Person[]; index: number; rect: DOMRect | null; command: (p: { id: string; label: string }) => void };

export type RichTextEditorProps = {
  kind: RichTextKind;
  label: string;
  initial: RichTextDoc | null;
  /** People who can be @mentioned (the project's members). */
  people: Person[];
  onChange: (doc: RichTextDoc, isEmpty: boolean) => void;
  /** Ctrl/Cmd+Enter. */
  onSubmit?: () => void;
  autoFocus?: boolean;
};

export default function RichTextEditor({ kind, label, initial, people, onChange, onSubmit, autoFocus }: RichTextEditorProps) {
  const listboxId = useId();
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const suggestRef = useRef<SuggestState | null>(null);
  suggestRef.current = suggest;
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const isDescription = kind === "description";

  const editor = useEditor({
    immediatelyRender: true,
    autofocus: autoFocus ? "end" : false,
    content: initial ?? undefined,
    extensions: [
      StarterKit.configure({
        heading: isDescription ? { levels: [2, 3] } : false,
        orderedList: isDescription ? {} : false,
        blockquote: isDescription ? {} : false,
        codeBlock: isDescription ? {} : false,
        horizontalRule: isDescription ? {} : false,
        underline: isDescription ? {} : false,
        strike: isDescription ? {} : false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          isAllowedUri: (url) => isSafeHref(url),
        },
      }),
      Mention.configure({
        HTMLAttributes: { class: "rounded-chip bg-accent-soft px-1 font-medium text-accent-ink" },
        renderText: ({ node }) => `@${node.attrs.label}`,
        suggestion: {
          items: ({ query }) => peopleRef.current.filter((p) => fuzzyMatch(p.name, query)).slice(0, 8),
          render: () => ({
            onStart: (props: SuggestionProps<Person>) =>
              setSuggest({ items: props.items, index: 0, rect: props.clientRect?.() ?? null, command: props.command as SuggestState["command"] }),
            onUpdate: (props: SuggestionProps<Person>) =>
              setSuggest((s) => ({
                items: props.items,
                index: Math.min(s?.index ?? 0, Math.max(0, props.items.length - 1)),
                rect: props.clientRect?.() ?? null,
                command: props.command as SuggestState["command"],
              })),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              const s = suggestRef.current;
              if (!s) return false;
              if (event.key === "Escape") {
                setSuggest(null);
                return true;
              }
              if (s.items.length === 0) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const step = event.key === "ArrowDown" ? 1 : -1;
                setSuggest({ ...s, index: (s.index + step + s.items.length) % s.items.length });
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                const p = s.items[s.index]!;
                s.command({ id: String(p.id), label: p.name });
                return true;
              }
              return false;
            },
            onExit: () => setSuggest(null),
          }),
        },
      }),
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        class: cn(
          "min-h-28 px-3 py-2 text-body text-ink outline-none",
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_h2]:text-body [&_h2]:font-semibold [&_h3]:font-semibold",
          "[&_blockquote]:border-l-4 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_code]:rounded-chip [&_code]:bg-hover [&_code]:px-1",
          "[&_pre]:rounded-control [&_pre]:bg-hover [&_pre]:p-3 [&_a]:text-accent-ink [&_a]:underline [&_p]:my-1",
        ),
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && submitRef.current) {
          submitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as RichTextDoc, e.isEmpty),
  });

  // The listbox is announced through the editor's aria-activedescendant (section 11.5).
  useEffect(() => {
    // editor.view throws until Tiptap has mounted it; the next suggestion update runs this again.
    let dom: HTMLElement | undefined;
    try {
      dom = editor?.view.dom;
    } catch {
      return;
    }
    if (!dom) return;
    // A textbox may carry aria-activedescendant and aria-controls, but not aria-expanded.
    if (suggest && suggest.items.length > 0) {
      dom.setAttribute("aria-controls", listboxId);
      dom.setAttribute("aria-activedescendant", `${listboxId}-${suggest.index}`);
    } else {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    }
  }, [editor, suggest, listboxId]);

  return (
    <div className="rounded-control border border-line-strong bg-card focus-within:border-ink-2">
      {editor && <Toolbar editor={editor} kind={kind} label={label} />}
      <EditorContent editor={editor} />
      {suggest && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="People to mention"
          className="fixed z-50 max-h-64 w-64 overflow-y-auto rounded-control border border-line bg-elevated p-1 shadow-floating"
          style={suggest.rect ? { top: suggest.rect.bottom + 4, left: Math.min(suggest.rect.left, window.innerWidth - 272) } : { display: "none" }}
        >
          {suggest.items.length === 0 ? (
            <li className="px-3 py-2 text-secondary text-ink-2">No one matches.</li>
          ) : (
            suggest.items.map((p, i) => (
              <li
                key={p.id}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === suggest.index}
                onMouseDown={(e) => {
                  e.preventDefault();
                  suggest.command({ id: String(p.id), label: p.name });
                }}
                className={cn("flex min-h-touch cursor-default items-center gap-2 rounded-chip px-3 text-body", i === suggest.index && "bg-hover")}
              >
                <Avatar name={p.name} url={p.avatarUrl} size="sm" />
                {p.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Toolbar({ editor, kind, label }: { editor: Editor; kind: RichTextKind; label: string }) {
  const tools = TOOLS.filter((t) => t.kinds.includes(kind));
  const [focusIndex, setFocusIndex] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const state = useEditorState({ editor, selector: ({ editor: e }) => ({ active: tools.map((t) => t.active(e)), link: e.isActive("link") }) });
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState<string>();
  const count = tools.length + 1;

  function onKeyDown(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let next = focusIndex;
    if (step) next = (focusIndex + step + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else return;
    e.preventDefault();
    setFocusIndex(next);
    refs.current[next]?.focus();
  }

  const button = (i: number, toolLabel: string, icon: LucideIcon, pressed: boolean, onClick: () => void) => (
    <button
      key={toolLabel}
      ref={(el) => {
        refs.current[i] = el;
      }}
      type="button"
      tabIndex={i === focusIndex ? 0 : -1}
      aria-label={toolLabel}
      aria-pressed={pressed}
      title={toolLabel}
      onMouseDown={(e) => e.preventDefault()}
      onFocus={() => setFocusIndex(i)}
      onClick={onClick}
      className={cn(
        "inline-flex size-touch items-center justify-center rounded-chip text-ink state-hover:bg-hover",
        pressed && "bg-accent-soft text-accent-ink",
      )}
    >
      <Icon icon={icon} size="sm" />
    </button>
  );

  return (
    <Popover open={linkOpen} onOpenChange={setLinkOpen}>
      <PopoverAnchor asChild>
        <div role="toolbar" aria-label={`${label} formatting`} onKeyDown={onKeyDown} className="flex flex-wrap gap-0.5 border-b border-line p-1">
          {tools.map((t, i) => button(i, t.label, t.icon, state.active[i] ?? false, () => t.run(editor)))}
          {button(tools.length, state.link ? "Edit link" : "Add link", LinkIcon, state.link, () => {
            setHref((editor.getAttributes("link").href as string | undefined) ?? "");
            setLinkError(undefined);
            setLinkOpen(true);
          })}
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" aria-label="Link">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const value = href.trim();
            const url = value && !/^[a-z]+:/i.test(value) ? `https://${value}` : value;
            if (url && !isSafeHref(url)) {
              setLinkError("Use a web address (https://…) or an email link (mailto:…).");
              return;
            }
            const chain = editor.chain().focus().extendMarkRange("link");
            if (url) chain.setLink({ href: url }).run();
            else chain.unsetLink().run();
            setLinkOpen(false);
          }}
        >
          <Field label="Link address" error={linkError}>
            <TextInput value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://" autoComplete="off" />
          </Field>
          <div className="flex gap-2">
            <Button type="submit">Save link</Button>
            {state.link && (
              <Button
                variant="secondary"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setLinkOpen(false);
                }}
              >
                Remove link
              </Button>
            )}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
