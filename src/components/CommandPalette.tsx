import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bug, FolderKanban, FolderPlus, House, Inbox, Lightbulb, type LucideIcon, Mail, Moon, Plus, Search, Settings2, Sparkles, Sun, SunMoon } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router";
import type { MeResponse } from "../../shared/auth";
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS, searchResponse } from "../../shared/work";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { fuzzyMatch } from "../lib/fuzzy";
import { useSaveTheme } from "../lib/profile";
import { useMyProjects } from "../lib/projects";
import { ProjectGlyph } from "./shell/AppShell";
import { TypeIcon } from "./tasks/bits";
import { Icon } from "./ui/Icon";
import { usePortalContainer } from "./ui/portal";

// Command palette (NAV-2, section 11.11): Ctrl+K or Cmd+K from any screen. One listbox of actions, projects
// and tasks the person can see, each type marked by its group and icon. Arrow keys move, Enter runs, Escape
// closes and returns focus. Full screen on phones (section 12).

export const OPEN_PALETTE_EVENT = "cph:open-palette";

/** Opens the palette from a button (keyboard users have the shortcut). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

type Item = { id: string; group: "Actions" | "Projects" | "Tasks"; label: string; detail?: string; icon: ReactNode; run: () => void };

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette({ me }: { me: MeResponse }) {
  const [open, setOpen] = useState(false);
  // Opened from code, so Radix can't know the trigger: remember what had focus and return there (section 11.11).
  const returnTo = useRef<HTMLElement | null>(null);
  const remember = () => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) returnTo.current = document.activeElement;
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (!o) remember();
          return !o;
        });
      }
    };
    const onOpen = () => {
      remember();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  const container = usePortalContainer();
  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal container={container}>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <RadixDialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            const target = returnTo.current;
            returnTo.current = null;
            if (target?.isConnected) {
              e.preventDefault();
              target.focus();
            }
          }}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-elevated text-ink shadow-modal outline-none",
            "inset-0 md:inset-x-0 md:top-[12vh] md:bottom-auto md:mx-auto md:max-h-[70vh] md:w-full md:max-w-2xl md:rounded-card",
            "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
          )}
        >
          <RadixDialog.Title className="sr-only">Go to</RadixDialog.Title>
          {open && <Palette me={me} onClose={() => setOpen(false)} />}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function Palette({ me, onClose }: { me: MeResponse; onClose: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const saveTheme = useSaveTheme(me);
  const projects = useMyProjects();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const search = useQuery({
    queryKey: ["search", q],
    enabled: q.length >= SEARCH_MIN_CHARS,
    queryFn: async () => searchResponse.parse(await api(`/api/search?q=${encodeURIComponent(q)}`)),
  });

  const go = (to: string) => () => {
    onClose();
    navigate(to);
  };
  const current = matchPath("/projects/:key", pathname)?.params.key;
  const query = text.trim();

  const items = useMemo<Item[]>(() => {
    const actionIcon = (icon: LucideIcon) => <Icon icon={icon} className="text-ink-2" />;
    const actions: Item[] = [
      ...(current ? [{ id: "a-new", group: "Actions" as const, label: `New task in ${current.toUpperCase()}`, icon: actionIcon(Plus), run: go(`/projects/${current}?new=1`) }] : []),
      ...(query.length >= SEARCH_MIN_CHARS
        ? [{ id: "a-search", group: "Actions" as const, label: `Search everything for “${query}”`, icon: actionIcon(Search), run: go(`/search?q=${encodeURIComponent(query)}`) }]
        : []),
      { id: "a-work", group: "Actions", label: "Go to My Work", icon: actionIcon(House), run: go("/work") },
      { id: "a-projects", group: "Actions", label: "Go to all projects", icon: actionIcon(FolderKanban), run: go("/projects") },
      { id: "a-request", group: "Actions", label: "Request access to more projects", icon: actionIcon(FolderPlus), run: go("/request-access") },
      { id: "a-news", group: "Actions", label: "What's New", icon: actionIcon(Sparkles), run: go("/whats-new") },
      { id: "a-bug", group: "Actions", label: "Report a bug", icon: actionIcon(Bug), run: go("/feedback/bug") },
      { id: "a-idea", group: "Actions", label: "Request a feature", icon: actionIcon(Lightbulb), run: go("/feedback/feature") },
      { id: "a-email", group: "Actions", label: "Email settings", icon: actionIcon(Mail), run: go("/settings/notifications") },
      ...(me.canReviewAccess ? [{ id: "a-queue", group: "Actions" as const, label: "Open access requests", icon: actionIcon(Inbox), run: go("/admin/requests") }] : []),
      ...(me.user.appRole === "admin" ? [{ id: "a-manage", group: "Actions" as const, label: "Manage projects", icon: actionIcon(Settings2), run: go("/admin/projects") }] : []),
      { id: "a-light", group: "Actions", label: "Switch to light theme", icon: actionIcon(Sun), run: () => void saveTheme("light") },
      { id: "a-dark", group: "Actions", label: "Switch to dark theme", icon: actionIcon(Moon), run: () => void saveTheme("dark") },
      { id: "a-system", group: "Actions", label: "Use the system theme", icon: actionIcon(SunMoon), run: () => void saveTheme("system") },
    ];
    const visibleActions = query ? actions.filter((a) => a.id === "a-search" || fuzzyMatch(a.label, query)) : actions.slice(0, 6);
    const projectItems: Item[] = (projects.data ?? [])
      .filter((p) => !query || fuzzyMatch(`${p.name} ${p.key}`, query))
      .slice(0, 6)
      .map((p) => ({ id: `p-${p.id}`, group: "Projects", label: p.name, detail: p.key, icon: <ProjectGlyph project={p} />, run: go(`/projects/${p.key}`) }));
    const data = q.length >= SEARCH_MIN_CHARS ? search.data : undefined;
    const tasks = data ? [...(data.exact ? [data.exact] : []), ...data.tasks.filter((t) => t.id !== data.exact?.id)] : [];
    const taskItems: Item[] = tasks.slice(0, 8).map((t) => ({
      id: `t-${t.id}`,
      group: "Tasks",
      label: t.title,
      detail: `${t.key} · ${t.stateName}`,
      icon: <TypeIcon type={t.type} />,
      run: go(`/projects/${t.project.key}?task=${t.key}`),
    }));
    // With nothing typed, actions lead. Once someone types, matching tasks (a key like MEDIA-42 first) and
    // projects come before the actions.
    if (!query) return [...visibleActions, ...projectItems];
    return data?.exact ? [...taskItems, ...projectItems, ...visibleActions] : [...projectItems, ...taskItems, ...visibleActions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, q, current, projects.data, search.data, me]);

  useEffect(() => setActive(0), [query, search.data]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (e.key === "Home" && e.ctrlKey) {
      setActive(0);
    } else if (e.key === "End" && e.ctrlKey) {
      setActive(items.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  }

  const searching = q.length >= SEARCH_MIN_CHARS && search.isFetching;
  // Groups appear in the order of their first item, so arrow keys move down the screen.
  const order = [...new Set(items.map((i) => i.group))];
  const groups = order.map((g) => ({ g, list: items.map((it, index) => ({ it, index })).filter((x) => x.it.group === g) }));

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Icon icon={Search} className="text-ink-2" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items[active] ? `${listId}-${items[active]!.id}` : undefined}
          aria-label="Search projects, tasks and actions"
          placeholder="Search projects, tasks and actions"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-14 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-2"
        />
        <RadixDialog.Close className="rounded-chip px-2 py-1 text-label text-ink-2 state-hover:bg-hover">Esc</RadixDialog.Close>
      </div>
      <p className="sr-only" aria-live="polite">
        {searching ? "Searching" : `${items.length} results`}
      </p>
      <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="flex-1 overflow-y-auto p-2">
        {groups.map(({ g, list }) =>
          list.length === 0 ? null : (
            <li key={g} role="presentation" className="mb-2">
              <p id={`${listId}-${g}`} className="px-3 pt-2 pb-1 text-label text-ink-2" aria-hidden="true">
                {g}
              </p>
              <ul role="group" aria-labelledby={`${listId}-${g}`}>
                {list.map(({ it, index }) => (
                  <li
                    key={it.id}
                    id={`${listId}-${it.id}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === active}
                    onMouseMove={() => setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={it.run}
                    className={cn("flex min-h-touch cursor-default items-center gap-3 rounded-chip px-3 text-body", index === active && "bg-hover")}
                  >
                    {it.icon}
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.detail && <span className="text-caption text-ink-2 tabular-nums">{it.detail}</span>}
                    {index === active && <Icon icon={ArrowRight} size="sm" className="text-ink-2" />}
                  </li>
                ))}
              </ul>
            </li>
          ),
        )}
        {q.length >= SEARCH_MIN_CHARS && search.isError && (
          <li role="presentation" className="px-3 py-2 text-secondary text-danger-ink">
            Search didn't work. Check your connection and try again.
          </li>
        )}
        {searching && items.every((i) => i.group !== "Tasks") && (
          <li role="presentation" className="px-3 py-2 text-secondary text-ink-2">
            Searching tasks…
          </li>
        )}
        {!searching && items.length === 0 && (
          <li role="presentation" className="px-3 py-2 text-secondary text-ink-2">
            No matches. Try fewer letters.
          </li>
        )}
      </ul>
    </>
  );
}
