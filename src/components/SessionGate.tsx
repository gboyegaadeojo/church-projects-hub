import type { ReactNode } from "react";
import { Navigate } from "react-router";
import type { MeResponse } from "../../shared/auth";
import { useProfileTheme } from "../lib/profile";
import { homeFor, useSession } from "../lib/session";
import { Skeleton, useDelayedFlag } from "./ui/Skeleton";

/**
 * Renders a signed-in page, or sends the person where they belong: signed out → home,
 * session ended → sign-in with the message (AUTH-7), suspended → the suspended screen (section 11.7),
 * signed in but not allowed here → their own home. The API enforces all of this too (NFR-1).
 */
export function SessionGate({
  allow = () => true,
  children,
}: {
  allow?: (me: MeResponse) => boolean;
  children: (me: MeResponse) => ReactNode;
}) {
  const session = useSession();
  const showSkeleton = useDelayedFlag(session.isPending);
  useProfileTheme(session.data?.kind === "signed-in" ? session.data.me.user.theme : undefined);

  if (session.isPending) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4" aria-busy="true">
        {showSkeleton && (
          <>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-5 w-full" />
          </>
        )}
      </main>
    );
  }
  const state = session.data;
  if (state?.kind === "offline") {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-3 px-4 text-center">
        <h1 className="text-title text-ink">You're offline</h1>
        <p className="text-body text-ink-2">This page hasn't been saved on this device yet. Reconnect to open it.</p>
      </main>
    );
  }
  if (!state || state.kind === "signed-out") return <Navigate to="/" replace />;
  if (state.kind === "ended") return <Navigate to="/?signin=ended" replace />;
  if (state.kind === "suspended") return <Navigate to="/suspended" replace />;
  if (!allow(state.me)) return <Navigate to={homeFor(state.me)} replace />;
  return <>{children(state.me)}</>;
}
