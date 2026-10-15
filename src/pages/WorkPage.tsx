import { CircleCheck, FolderPlus } from "lucide-react";
import { Link } from "react-router";
import { ACCESS_COPY } from "../../shared/access";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { buttonClasses } from "../components/ui/Button";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { welcomeLine } from "../lib/greeting";
import { useMyProjects } from "../lib/projects";

// My Work (section 11.1), the first screen after an approved sign-in. Tasks arrive in Stage 3 (NAV-3);
// until then it greets the person and shows the matching empty state.

export const WORK_COPY = {
  allCaughtUp: "You're all caught up. Check the board for work you can pick up.",
} as const;

export function WorkPage() {
  const me = useMe();
  const projects = useMyProjects();
  const showSkeleton = useDelayedFlag(projects.isPending);

  return (
    <PageLayout title="My Work" intro={welcomeLine(me.user.timezone)}>
      {projects.isPending ? (
        <div aria-busy="true" aria-label="Loading your work" className="flex flex-col gap-3">
          {showSkeleton && (
            <>
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-20 w-full" />
            </>
          )}
        </div>
      ) : projects.isError ? (
        <ErrorState
          title="We couldn't load your work."
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
        <EmptyState
          icon={CircleCheck}
          title={WORK_COPY.allCaughtUp}
          action={
            <Link to="/projects" className={buttonClasses()}>
              Go to projects
            </Link>
          }
        />
      )}
    </PageLayout>
  );
}
