import { ChartColumn, Kanban, Layers, List, ListOrdered, type LucideIcon, Settings2, Users } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router";
import { cn } from "../../lib/cn";
import { Icon } from "../ui/Icon";

// A project's sections: Board, List, Backlog, Epics, Reports, Members and Settings. From tablet width up they sit in
// the sidebar under the open project (v4.7, easy to find); on phones, which have no sidebar, as a row of tabs.
// Board, List, Backlog and Epics keep the current filters (they live in the URL), so switching views loses nothing.

export type ProjectTab = "board" | "list" | "backlog" | "epics" | "reports" | "members" | "settings";
export type WorkView = "board" | "list" | "backlog" | "epics";
const WORK_VIEWS: WorkView[] = ["board", "list", "backlog", "epics"];

export type ProjectNavItem = { id: ProjectTab; to: string; label: string; icon: LucideIcon; current: boolean };

/** Which section of which project the URL shows, or null outside a project. */
export function currentProjectTab(pathname: string, params: URLSearchParams): { key: string; tab: ProjectTab } | null {
  const m = /^\/projects\/([^/]+)(?:\/(reports|members|settings))?\/?$/.exec(pathname);
  if (!m) return null;
  const section = m[2] as ProjectTab | undefined;
  const view = params.get("view");
  const tab: ProjectTab = section ?? (view === "list" || view === "backlog" || view === "epics" ? view : "board");
  return { key: m[1]!.toUpperCase(), tab };
}

/** The project's sections as links, marking the one on screen. */
export function useProjectNav(projectKey: string): ProjectNavItem[] {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const here = currentProjectTab(pathname, params);
  const active = here?.key === projectKey.toUpperCase() ? here.tab : null;
  const base = `/projects/${projectKey}`;
  const view = (v: WorkView) => {
    // Between the board, list, backlog and epics, carry the filters across; from elsewhere start clean.
    const next = active && WORK_VIEWS.includes(active as WorkView) ? new URLSearchParams(params) : new URLSearchParams();
    next.delete("task");
    next.delete("new");
    if (v !== "board") next.set("view", v);
    else next.delete("view");
    const q = next.toString();
    return q ? `${base}?${q}` : base;
  };
  const items: Omit<ProjectNavItem, "current">[] = [
    { id: "board", to: view("board"), label: "Board", icon: Kanban },
    { id: "list", to: view("list"), label: "List", icon: List },
    { id: "backlog", to: view("backlog"), label: "Backlog", icon: ListOrdered },
    { id: "epics", to: view("epics"), label: "Epics", icon: Layers },
    { id: "reports", to: `${base}/reports`, label: "Reports", icon: ChartColumn },
    { id: "members", to: `${base}/members`, label: "Members", icon: Users },
    { id: "settings", to: `${base}/settings`, label: "Settings", icon: Settings2 },
  ];
  return items.map((i) => ({ ...i, current: i.id === active }));
}

/** Phones only: the sidebar holds these links from tablet width up. */
export function ProjectTabs({ projectKey }: { projectKey: string; active?: ProjectTab }) {
  const tabs = useProjectNav(projectKey);
  return (
    <nav aria-label="Project" className="-mx-4 overflow-x-auto px-4 md:hidden">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((t) => (
          <li key={t.id}>
            <Link
              to={t.to}
              aria-current={t.current ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-touch items-center gap-2 border-b-2 px-3 text-secondary",
                "transition-colors duration-(--duration-menu) ease-out",
                t.current ? "border-accent font-semibold text-accent-ink" : "border-transparent text-ink-2 state-hover:border-line-strong state-hover:text-ink",
              )}
            >
              <Icon icon={t.icon} size="sm" />
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
