import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { AUTH_COPY, type SignInOutcome } from "../../shared/auth";
import { Button } from "../components/ui/Button";
import { homeFor, useSession } from "../lib/session";
import { startGoogleSignIn } from "../lib/signin";

// Public home page (AUTH-10, section 11.15). Signed-in users are sent straight on.

const OUTCOME_COPY: Record<SignInOutcome, string> = {
  failed: AUTH_COPY.signInFailed,
  // Section 11.7: the session-ended screen is sign-in with this single line.
  ended: AUTH_COPY.sessionEnded,
};

export function HomePage() {
  const session = useSession();
  const [params] = useSearchParams();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  if (session.data?.kind === "signed-in") return <Navigate to={homeFor(session.data.me)} replace />;
  if (session.data?.kind === "suspended") return <Navigate to="/suspended" replace />;

  const outcome = (session.data?.kind === "ended" ? "ended" : params.get("signin")) as SignInOutcome | null;
  const message = startError ?? (outcome ? OUTCOME_COPY[outcome] : null) ?? null;

  async function signIn() {
    setStarting(true);
    setStartError(null);
    setStartError(await startGoogleSignIn());
    setStarting(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="text-large-title">Church Projects Hub</h1>
      <p className="text-ink-2">
        A private work tracker for Immanuel Fellowship Church volunteer teams. Each team plans and tracks its own
        projects; an admin approves who can see what.
      </p>
      {message && (
        <p role="alert" className="rounded-card border border-danger-line bg-danger-soft px-4 py-3 text-secondary text-ink">
          {message}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-4">
          <Button loading={starting} onClick={signIn}>
            Sign in with Google
          </Button>
          <Link to="/privacy" className="text-accent-ink underline-offset-4 hover:underline">
            Privacy policy
          </Link>
        </div>
        <p className="text-secondary text-ink-2">{AUTH_COPY.accountHint}</p>
      </div>
    </main>
  );
}
