import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { acceptInviteResponse, type InviteOutcome, inviteLookupResponse, PROJECT_ROLE_LABELS } from "../../shared/access";
import { AUTH_COPY } from "../../shared/auth";
import { Button } from "../components/ui/Button";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { ErrorState } from "../components/ui/States";
import { api } from "../lib/api";
import { SESSION_QUERY_KEY, useSession } from "../lib/session";
import { startGoogleSignIn } from "../lib/signin";

// Invite link landing (AUTH-9, section 11.6): "You've been invited to [Project] as [Role]. Sign in with
// Google to accept." Signed-out people accept through sign-in; signed-in people accept directly.

const LANDING: Record<InviteOutcome, string> = {
  accepted: "/work",
  expired: "/invite-expired",
  mismatch: "/invite-mismatch",
};

export function InvitePage() {
  const { token = "" } = useParams();
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: async () => inviteLookupResponse.parse(await api(`/api/invites/${encodeURIComponent(token)}`)),
    retry: 1,
  });
  const showSkeleton = useDelayedFlag(invite.isPending || session.isPending);

  const accept = useMutation({
    mutationFn: (csrfToken: string) =>
      api(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST", csrfToken }).then((b) =>
        acceptInviteResponse.parse(b),
      ),
    onSuccess: async ({ outcome }) => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      navigate(LANDING[outcome], { replace: true });
    },
  });

  if (invite.isPending || session.isPending) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4" aria-busy="true">
        {showSkeleton && <Skeleton className="h-8 w-full" />}
      </main>
    );
  }
  if (invite.isError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4">
        <ErrorState title="We couldn't load this invitation." description="Check your connection and try again." onRetry={() => void invite.refetch()} />
      </main>
    );
  }
  if (invite.data.status === "expired") return <Navigate to="/invite-expired" replace />;
  if (session.data?.kind === "suspended") return <Navigate to="/suspended" replace />;

  const { projectName, role } = invite.data;
  const signedIn = session.data?.kind === "signed-in" ? session.data.me : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <p className="text-secondary font-medium text-ink-2">Church Projects Hub</p>
      <h1 className="text-title">
        You've been invited to {projectName} as {PROJECT_ROLE_LABELS[role]}.
        {!signedIn && " Sign in with Google to accept."}
      </h1>
      {(error || accept.isError) && (
        <p role="alert" className="rounded-card border border-danger-line bg-danger-soft px-4 py-3 text-secondary text-ink">
          {error ?? "That didn't go through. Check your connection and try again."}
        </p>
      )}
      {signedIn ? (
        <div className="flex flex-col gap-2">
          <div>
            <Button loading={accept.isPending} onClick={() => accept.mutate(signedIn.csrfToken)}>
              Accept invitation
            </Button>
          </div>
          <p className="text-secondary text-ink-2">Signed in as {signedIn.user.email}.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              loading={starting}
              onClick={async () => {
                setStarting(true);
                setError(await startGoogleSignIn(token));
                setStarting(false);
              }}
            >
              Sign in with Google
            </Button>
            <Link to="/privacy" className="text-accent-ink underline-offset-4 hover:underline">
              Privacy policy
            </Link>
          </div>
          <p className="text-secondary text-ink-2">{AUTH_COPY.accountHint}</p>
        </div>
      )}
    </main>
  );
}
