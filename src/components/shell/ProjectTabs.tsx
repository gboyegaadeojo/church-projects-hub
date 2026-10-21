import { ChartColumn, Kanban, Layers, List, ListOrdered, type LucideIcon, Settings2, Users } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { cn } from "../../lib/cn";
import { Icon } from "../ui/Icon";

// A project's sections as one row of tabs, the same on the board, reports and members pages.
// Board and List keep the current filters (they live in the URL), so switching views loses nothing.

export type ProjectTab = "board" | "list" | "backlog" | "epics" | "reports" | "members" | "settings";
export type WorkView = "board" | "list" | "backlog" | "epics";
const WORK_VIEWS: WorkView[] = ["board", "list", "backlog", "epics"];

export function ProjectTabs({ projectKey, active }: { projectKey: string; active: ProjectTab }) {
  const [params] = useSearchParams();
  const base = `/projects/${projectKey}`;
  const view = (v: WorkView) => {
    // Between the board, list, backlog and epics, carry the filters across; from elsewhere start clean.
    const next = WORK_VIEWS.includes(active as WorkView) ? new URLSearchParams(params) : new URLSearchParams();
    next.delete("task");
    next.delete("new");
    if (v !== "board") next.set("view", v);
    else next.delete("view");
    const q = next.toString();
    return q ? `${base}?${q}` : base;
  };
  const tabs: { id: ProjectTab; to: string; label: string; icon: LucideIcon }[] = [
    { id: "board", to: view("board"), label: "Board", icon: Kanban },
    { id: "list", to: view("list"), label: "List", icon: List },
    { id: "backlog", to: view("backlog"), label: "Backlog", icon: ListOrdered },
    { id: "epics", to: view("epics"), label: "Epics", icon: Layers },
    { id: "reports", to: `${base}/reports`, label: "Reports", icon: ChartColumn },
    { id: "members", to: `${base}/members`, label: "Members", icon: Users },
    { id: "settings", to: `${base}/settings`, label: "Settings", icon: Settings2 },
  ];
  return (
    <nav aria-label="Project" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((t) => {
          const current = t.id === active;
          return (
            <li key={t.id}>
              <Link
                to={t.to}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-touch items-center gap-2 border-b-2 px-3 text-secondary",
                  "transition-colors duration-(--duration-menu) ease-out",
                  current ? "border-accent font-semibold text-accent-ink" : "border-transparent text-ink-2 state-hover:border-line-strong state-hover:text-ink",
                )}
              >
                <Icon icon={t.icon} size="sm" />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
