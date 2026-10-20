import { EyeOff, FolderPlus, Lock } from "lucide-react";
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ACCESS_COPY, PROJECT_ROLE_LABELS } from "../../shared/access";
import type { ProjectSummary } from "../../shared/projects";
import { ProjectTile, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Badge } from "../components/ui/Badge";
import { buttonClasses } from "../components/ui/Button";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { cn } from "../lib/cn";
import { PROJECT_COLOUR_CLASSES, useMyProjects } from "../lib/projects";

// The projects a person can see (section 2). A project's own page (board and list) is ProjectPage.tsx.

export function ProjectBadges({ project }: { project: ProjectSummary }) {
  return (
    <span className="flex flex-wrap gap-2">
      {project.role && <Badge>{PROJECT_ROLE_LABELS[project.role]}</Badge>}
      {project.isSystem && (
        <Badge tone="info" icon={Lock}>
          App Admins only
        </Badge>
      )}
      {project.hidden && !project.isSystem && (
        <Badge tone="info" icon={EyeOff}>
          Hidden
        </Badge>
      )}
      {project.archived && <Badge tone="warning">Archived</Badge>}
    </span>
  );
}

export function ProjectsPage() {
  const me = useMe();
  const projects = useMyProjects();
  const showSkeleton = useDelayedFlag(projects.isPending);
  return (
    <PageLayout
      title="Projects"
      actions={
        me.user.appRole === "admin" && (
          <Link to="/admin/projects" className={buttonClasses("secondary")}>
            Manage projects
          </Link>
        )
      }
    >
      {projects.isPending ? (
        <div aria-busy="true" aria-label="Loading projects" className="grid gap-4 sm:grid-cols-2">
          {showSkeleton && [0, 1].map((i) => <Skeleton key={i} className="h-28 rounded-card" />)}
        </div>
      ) : projects.isError ? (
        <ErrorState
          title="We couldn't load your projects."
          description="Check your connection and try again."
          onRetry={() => void projects.refetch()}
          retrying={projects.isFetching}
        />
      ) : projects.data.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title={ACCESS_COPY.noProjects}
          action={
            <Link to="/request-access" className={buttonClasses()}>
              Request access
            </Link>
          }
        />
      ) : (
        <ul className="stagger grid gap-4 sm:grid-cols-2">
          {projects.data.map((p, i) => (
            <li key={p.id} style={{ "--i": i } as CSSProperties}>
              <Link
                to={`/projects/${p.key}`}
                className="lift relative flex h-full flex-col gap-3 overflow-hidden rounded-card border border-line bg-card p-component pt-6 shadow-raised state-hover:border-accent"
              >
                {/* The project's colour as a band across the top of its card */}
                <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-1.5", PROJECT_COLOUR_CLASSES[p.colour].bg)} />
                <span className="flex items-center gap-3">
                  <ProjectTile project={p} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body font-semibold text-ink">{p.name}</span>
                    <span className="text-caption text-ink-2 tabular-nums">{p.key}</span>
                  </span>
                </span>
                {p.description && <span className="line-clamp-2 text-secondary text-ink-2">{p.description}</span>}
                <ProjectBadges project={p} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-secondary text-ink-2">
        Looking for another team?{" "}
        <Link to="/request-access" className="text-accent-ink underline underline-offset-4">
          Request access to more projects
        </Link>
      </p>
    </PageLayout>
  );
}
