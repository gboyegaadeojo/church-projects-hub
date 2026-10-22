import { Check, ChevronsUpDown, FolderPlus, LayoutGrid } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import type { MeResponse } from "../../../shared/auth";
import type { ProjectSummary } from "../../../shared/projects";
import { cn } from "../../lib/cn";
import { useMyProjects } from "../../lib/projects";
import { Dialog, SheetContent } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { ProjectTile } from "./AppShell";
import { currentProjectTab, type ProjectTab } from "./ProjectTabs";

// Phones (v4.7): inside a project, the top bar names the open project (its tile and name), so people always know
// where they are. Tapping it opens a sheet of their projects to switch to; the same section stays open (Backlog in
// one project opens Backlog in the next). Tablets and desktops have the sidebar for this.

const ROLE_WORDS: Record<string, string> = { admin: "Project Admin", contributor: "Contributor", viewer: "Viewer" };

/** Where switching to `project` lands, keeping the section on screen when the person can open it there. */
function destination(project: ProjectSummary, tab: ProjectTab, me: MeResponse): string {
  const base = `/projects/${project.key}`;
  if (tab === "reports" || tab === "members") return `${base}/${tab}`;
  if (tab === "settings") return me.user.appRole === "admin" || project.role === "admin" ? `${base}/settings` : base;
  // Filters name people and labels of the old project, so they don't carry across.
  return tab === "board" ? base : `${base}?view=${tab}`;
}

export function MobileProjectSwitcher({ me }: { me: MeResponse }) {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const projects = useMyProjects();
  const [open, setOpen] = useState(false);
  const here = currentProjectTab(pathname, params);
  const current = here ? projects.data?.find((p) => p.key === here.key) : undefined;
  if (!here || !current) return null;
  const all = projects.data ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Project: ${current.name}. Switch project`}
        className="flex min-h-touch min-w-0 flex-1 items-center gap-2 rounded-control px-1.5 text-left state-hover:bg-hover md:hidden"
      >
        <ProjectTile project={current} size="sm" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-label text-ink-2">Project</span>
          <span className="truncate text-secondary font-semibold text-ink">{current.name}</span>
        </span>
        <Icon icon={ChevronsUpDown} size="sm" className="shrink-0 text-ink-2" />
      </button>
      <SheetContent title="Switch project">
        <nav aria-label="Your projects" className="-mx-1 flex flex-col">
          <ul className="flex flex-col gap-1">
            {all.map((p) => {
              const active = p.id === current.id;
              return (
                <li key={p.id}>
                  <Link
                    to={destination(p, here.tab, me)}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-touch items-center gap-3 rounded-control px-3 py-2 text-secondary",
                      active ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink state-hover:bg-hover",
                    )}
                  >
                    <ProjectTile project={p} size="md" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{p.name}</span>
                      <span className={cn("text-caption font-normal", active ? "text-accent-ink" : "text-ink-2")}>
                        {p.key}
                        {p.role ? ` · ${ROLE_WORDS[p.role] ?? p.role}` : ""}
                        {p.archived ? " · Archived" : ""}
                      </span>
                    </span>
                    {active && <Icon icon={Check} className="shrink-0" />}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
            <Link to="/projects" onClick={() => setOpen(false)} className="flex min-h-touch items-center gap-3 rounded-control px-3 text-secondary text-ink state-hover:bg-hover">
              <Icon icon={LayoutGrid} />
              All projects
            </Link>
            <Link to="/request-access" onClick={() => setOpen(false)} className="flex min-h-touch items-center gap-3 rounded-control px-3 text-secondary text-ink state-hover:bg-hover">
              <Icon icon={FolderPlus} />
              Request access to more projects
            </Link>
          </div>
        </nav>
      </SheetContent>
    </Dialog>
  );
}
