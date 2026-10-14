import { LogOut } from "lucide-react";
import { Navigate, useNavigate } from "react-router";
import { Button } from "../components/ui/Button";
import { homeFor, useSession, useSignOut } from "../lib/session";

// Temporary landing page for approved members until My Work (NAV-3) and the app shell (Stage 2c).
export function WorkPage() {
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();

  if (session.isPending) return <main aria-busy="true" />;
  const state = session.data;
  if (!state || state.kind === "signed-out") return <Navigate to="/" replace />;
  if (state.kind !== "signed-in") return <Navigate to={`/?signin=${state.kind}`} replace />;
  if (state.me.user.status === "pending") return <Navigate to={homeFor(state.me)} replace />;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="text-title">My Work</h1>
      <p className="text-ink-2">Signed in as {state.me.user.name}. Your projects will appear here.</p>
      <div>
        <Button
          variant="secondary"
          icon={LogOut}
          onClick={async () => {
            await signOut(state.me.csrfToken);
            navigate("/", { replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    </main>
  );
}
