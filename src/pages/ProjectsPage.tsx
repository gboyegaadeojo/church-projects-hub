import { EyeOff, FolderPlus, Lock } from "lucide-react";
import { Link } from "react-router";
import { ACCESS_COPY, PROJECT_ROLE_LABELS } from "../../shared/access";
import type { ProjectSummary } from "../../shared/projects";
import { ProjectGlyph, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Badge } from "../components/ui/Badge";
import { buttonClasses } from "../components/ui/Button";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { useMyProjects } from "../lib/projects";

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
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.data.map((p) => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.key}`}
                className="flex h-full flex-col gap-3 rounded-card border border-line bg-card p-component shadow-raised transition-colors duration-(--duration-micro) ease-out state-hover:bg-hover"
              >
                <span className="flex items-center gap-3">
                  <ProjectGlyph project={p} />
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{p.name}</span>
                  <span className="text-caption text-ink-2 tabular-nums">{p.key}</span>
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
