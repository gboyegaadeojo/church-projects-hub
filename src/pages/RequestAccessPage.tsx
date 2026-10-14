import { LogOut } from "lucide-react";
import { Navigate, useNavigate } from "react-router";
import { Button } from "../components/ui/Button";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { homeFor, useSession, useSignOut } from "../lib/session";

// Placeholder request screen for Pending users (AUTH-2). Project selection, the note and the live
// status screen arrive in Stage 2b (AUTH-3, section 11.6). No app navigation here.
export function RequestAccessPage() {
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const showSkeleton = useDelayedFlag(session.isPending);

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
  if (!state || state.kind === "signed-out") return <Navigate to="/" replace />;
  if (state.kind !== "signed-in") return <Navigate to={`/?signin=${state.kind}`} replace />;
  if (state.me.user.status !== "pending") return <Navigate to={homeFor(state.me)} replace />;

  const { user, csrfToken } = state.me;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <div className="flex items-center gap-4">
        {user.avatarUrl && (
          <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-12 rounded-full bg-hover" />
        )}
        <div>
          <p className="text-body font-medium text-ink">{user.name}</p>
          <p className="text-secondary text-ink-2">{user.email}</p>
        </div>
      </div>
      <h1 className="text-title">Request access</h1>
      <p className="text-ink-2">
        You're signed in. Next, you'll choose the projects you'd like to join and an admin will review your request.
      </p>
      <div>
        <Button
          variant="secondary"
          icon={LogOut}
          onClick={async () => {
            await signOut(csrfToken);
            navigate("/", { replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    </main>
  );
}
