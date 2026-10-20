import { type CSSProperties, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { AUTH_COPY, type SignInOutcome } from "../../shared/auth";
import { APP_NAME, BrandMark } from "../components/shell/BrandMark";
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
    <div className="relative min-h-dvh overflow-hidden bg-linear-160 from-hero-from via-page to-hero-to">
      {/* Soft brand glows; decorative only */}
      <span aria-hidden="true" className="pointer-events-none absolute -top-32 -left-32 size-96 rounded-full bg-brand-from opacity-10 blur-3xl" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-32 -bottom-32 size-96 rounded-full bg-brand-to opacity-10 blur-3xl" />
      <main className="relative mx-auto grid min-h-dvh max-w-6xl animate-rise-in items-center gap-12 px-4 py-12 md:px-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <BrandMark showName={false} />
          <h1 className="text-large-title text-ink">{APP_NAME}</h1>
          <p className="text-body text-ink-2">
            A private work tracker for Immanuel Fellowship Church volunteer teams. Each ministry team plans and tracks its
            own work here, and an admin approves who can see each project.
          </p>
          {message && (
            <p role="alert" className="rounded-card border border-danger-line bg-danger-soft px-4 py-3 text-secondary text-ink">
              {message}
            </p>
          )}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <Button loading={starting} onClick={signIn} className="min-h-12 px-6 text-body shadow-floating">
                Sign in with Google
              </Button>
              <Link to="/privacy" className="text-accent-ink underline underline-offset-4">
                Privacy policy
              </Link>
            </div>
            <p className="text-secondary text-ink-2">{AUTH_COPY.accountHint}</p>
          </div>
        </div>
        <BoardPreview />
      </main>
    </div>
  );
}

/** A small, decorative picture of a board: shows newcomers what the hub looks like. Hidden from screen readers. */
function BoardPreview() {
  const columns = [
    { name: "To Do", dot: "bg-status-todo", cards: ["Order new lanyards", "Plan the Easter run sheet"] },
    { name: "In Progress", dot: "bg-status-progress", cards: ["Test the stream encoder"] },
    { name: "Done", dot: "bg-status-done", cards: ["Replace mic batteries", "Print welcome cards"] },
  ];
  return (
    <div aria-hidden="true" className="hidden rounded-card border border-line bg-card/80 p-4 shadow-modal backdrop-blur lg:block">
      <div className="mb-4 flex items-center gap-2">
        <span className="size-3 rounded-full bg-project-red" />
        <span className="size-3 rounded-full bg-project-amber" />
        <span className="size-3 rounded-full bg-project-green" />
      </div>
      <div className="stagger grid grid-cols-3 gap-3">
        {columns.map((c, ci) => (
          <div key={c.name} className="flex flex-col gap-2 rounded-control bg-column p-2" style={{ "--i": ci } as CSSProperties}>
            <span className="flex items-center gap-2 px-1 text-caption font-semibold text-ink">
              <span className={`size-2 rounded-full ${c.dot}`} />
              {c.name}
            </span>
            {c.cards.map((title, i) => (
              <span key={title} className="flex flex-col gap-2 rounded-chip border border-line bg-card p-2 shadow-raised">
                <span className="text-caption text-ink">{title}</span>
                <span className="flex items-center justify-between">
                  <span className="text-label text-ink-2 tabular-nums">MEDIA-{12 + ci * 3 + i}</span>
                  <span className="size-5 rounded-full bg-linear-135 from-brand-from to-brand-to" />
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
