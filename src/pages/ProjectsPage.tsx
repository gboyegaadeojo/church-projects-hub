import { useQuery } from "@tanstack/react-query";
import { EyeOff, FolderPlus, Lock, SearchX, Settings2 } from "lucide-react";
import { Link, useParams } from "react-router";
import { ACCESS_COPY, PROJECT_ROLE_LABELS } from "../../shared/access";
import { projectResponse, type ProjectSummary } from "../../shared/projects";
import { ProjectGlyph, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Badge } from "../components/ui/Badge";
import { buttonClasses } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { api, ApiError } from "../lib/api";
import { useMyProjects } from "../lib/projects";

// The projects a person can see (section 2), and a project's own page. The board and project overview
// (PROJ-5) arrive in Stage 3; for now the page shows what the project is.

function ProjectBadges({ project }: { project: ProjectSummary }) {
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

export function ProjectPage() {
  const me = useMe();
  const { key = "" } = useParams();
  const project = useQuery({
    queryKey: ["projects", "by-key", key.toUpperCase()],
    queryFn: async () => projectResponse.parse(await api(`/api/projects/by-key/${encodeURIComponent(key)}`)).project,
    retry: (count, err) => !(err instanceof ApiError && (err.status === 403 || err.status === 404)) && count < 2,
  });
  const showSkeleton = useDelayedFlag(project.isPending);

  if (project.isPending) {
    return (
      <PageLayout title="Project">
        <div aria-busy="true" aria-label="Loading project">
          {showSkeleton && <Skeleton className="h-24 w-full rounded-card" />}
        </div>
      </PageLayout>
    );
  }
  if (project.isError) {
    const status = project.error instanceof ApiError ? project.error.status : 0;
    return (
      <PageLayout title="Project">
        {status === 404 ? (
          <EmptyState icon={SearchX} title="We couldn't find that project. Check the link, or pick one from your projects." action={<Link to="/projects" className={buttonClasses()}>Go to projects</Link>} />
        ) : status === 403 ? (
          <EmptyState
            icon={Lock}
            title="You don't have access to this project. Ask its admin, or request access."
            action={
              <Link to="/request-access" className={buttonClasses()}>
                Request access
              </Link>
            }
          />
        ) : (
          <ErrorState
            title="We couldn't load this project."
            description="Check your connection and try again."
            onRetry={() => void project.refetch()}
            retrying={project.isFetching}
          />
        )}
      </PageLayout>
    );
  }

  const p = project.data;
  return (
    <PageLayout
      title={p.name}
      intro={
        <span className="flex flex-col gap-3">
          <span className="flex items-center gap-2 text-secondary">
            <ProjectGlyph project={p} size="sm" />
            <span className="tabular-nums">{p.key}</span>
          </span>
          {p.description && <span>{p.description}</span>}
          <ProjectBadges project={p} />
        </span>
      }
      actions={
        me.user.appRole === "admin" &&
        !p.isSystem && (
          <Link to="/admin/projects" className={buttonClasses("secondary")}>
            <Icon icon={Settings2} />
            Edit project
          </Link>
        )
      }
    >
      <EmptyState icon={FolderPlus} title="Tasks and the board for this project are coming in the next update." />
    </PageLayout>
  );
}
