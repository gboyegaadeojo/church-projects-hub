import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ACCESS_COPY } from "../../shared/access";
import { AUTH_COPY } from "../../shared/auth";
import { Button } from "../components/ui/Button";
import { useSession, useSignOut } from "../lib/session";

// Security-state screens (section 11.7): no app navigation or task content, calm wording, no emoji.

function SecurityScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <p className="text-secondary font-medium text-ink-2">Church Projects Hub</p>
      <h1 className="text-title">{title}</h1>
      {children}
    </main>
  );
}

/** For screens reached with a session: sign out so the person can use the right Google account. */
function SignOutButton() {
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  if (session.data?.kind !== "signed-in") return null;
  const { csrfToken } = session.data.me;
  return (
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
  );
}

const linkClass = "text-accent-ink underline-offset-4 hover:underline";

export function SuspendedPage() {
  return (
    <SecurityScreen title="Access suspended">
      <p className="text-body text-ink">{AUTH_COPY.suspended}</p>
      <p className="text-body text-ink">
        <a className={linkClass} href={`mailto:${AUTH_COPY.contactEmail}`}>
          {AUTH_COPY.contactEmail}
        </a>
      </p>
    </SecurityScreen>
  );
}

export function InviteExpiredPage() {
  return (
    <SecurityScreen title="Invitation expired">
      <p className="text-body text-ink">{ACCESS_COPY.inviteExpired}</p>
      <div className="flex flex-wrap items-center gap-4">
        <Link className={linkClass} to="/">
          Continue
        </Link>
      </div>
    </SecurityScreen>
  );
}

export function InviteMismatchPage() {
  return (
    <SecurityScreen title="Different account">
      <p className="text-body text-ink">{ACCESS_COPY.inviteMismatch}</p>
      <div className="flex flex-wrap items-center gap-4">
        <SignOutButton />
        <Link className={linkClass} to="/">
          Continue
        </Link>
      </div>
    </SecurityScreen>
  );
}
