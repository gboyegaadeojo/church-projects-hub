import { LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router";
import type { MeResponse } from "../../shared/auth";
import { SessionGate } from "../components/SessionGate";
import { Button } from "../components/ui/Button";
import { useSignOut } from "../lib/session";

// Temporary landing page for approved members until My Work (NAV-3) and the app shell (Stage 2c).
export function WorkPage() {
  return <SessionGate allow={(me) => me.user.status === "active"}>{(me) => <Work me={me} />}</SessionGate>;
}

const linkClass = "text-accent-ink underline-offset-4 hover:underline";

function Work({ me }: { me: MeResponse }) {
  const signOut = useSignOut();
  const navigate = useNavigate();
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="text-title">My Work</h1>
      <p className="text-ink-2">Signed in as {me.user.name}. Your projects will appear here.</p>
      <nav aria-label="Account" className="flex flex-col gap-3">
        {me.canReviewAccess && (
          <Link to="/admin/requests" className={linkClass}>
            Access requests and invites
          </Link>
        )}
        {/* AUTH-5: moves to the profile menu with the app shell in Stage 2c. */}
        <Link to="/request-access" className={linkClass}>
          Request access to more projects
        </Link>
      </nav>
      <div>
        <Button
          variant="secondary"
          icon={LogOut}
          onClick={async () => {
            await signOut(me.csrfToken);
            navigate("/", { replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    </main>
  );
}
