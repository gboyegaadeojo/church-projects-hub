import { Link } from "react-router";

// Public home page (AUTH-10, section 11.15). Sign-in is wired up in Stage 2.
export function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="text-large-title">Church Projects Hub</h1>
      <p className="text-ink-2">
        A private work tracker for Immanuel Fellowship Church volunteer teams. Each team plans and tracks its own
        projects; an admin approves who can see what.
      </p>
      <div className="flex items-center gap-4">
        <button
          type="button"
          disabled
          className="rounded-[var(--radius-control)] bg-accent px-4 py-2 font-medium text-on-accent disabled:opacity-60"
        >
          Sign in with Google
        </button>
        <Link to="/privacy" className="text-accent-ink underline-offset-4 hover:underline">
          Privacy policy
        </Link>
      </div>
    </main>
  );
}
