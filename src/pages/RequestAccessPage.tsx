import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, LogOut } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ACCESS_COPY,
  ACCESS_ERRORS,
  type MyAccessRequest,
  myAccessRequestsResponse,
  NOTE_MAX,
  type ProjectTile,
  requestableProjectsResponse,
  STATUS_POLL_MS,
} from "../../shared/access";
import { AUTH_COPY, type MeResponse } from "../../shared/auth";
import { SessionGate } from "../components/SessionGate";
import { ShellFrame } from "../components/shell/AppShell";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Textarea } from "../components/ui/inputs";
import { ErrorState } from "../components/ui/States";
import { toast } from "../components/ui/Toast";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { SESSION_QUERY_KEY, useSignOut } from "../lib/session";

// Request access and the live status screen (AUTH-3, AUTH-5, AUTH-8, RATE-2, section 11.6).
// Pending people land here after sign-in; Active members come here to ask for more projects.

const FAILED = "That didn't go through. Check your connection and try again.";
const MINE_KEY = ["access-requests", "mine"] as const;
const REQUESTABLE_KEY = ["projects", "requestable"] as const;

/** Pending people see this page on its own; active members get it inside the app shell (carried over from 2c). */
export function RequestAccessPage() {
  return (
    <SessionGate allow={(me) => me.user.status === "pending" || me.user.status === "active"}>
      {(me) =>
        me.user.status === "active" ? (
          <ShellFrame me={me}>
            <RequestAccess me={me} inShell />
          </ShellFrame>
        ) : (
          <RequestAccess me={me} />
        )
      }
    </SessionGate>
  );
}

function RequestAccess({ me, inShell = false }: { me: MeResponse; inShell?: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const [choosing, setChoosing] = useState(false);

  const mine = useQuery({
    queryKey: MINE_KEY,
    queryFn: async () => myAccessRequestsResponse.parse(await api("/api/access-requests/mine")).requests,
    // Section 11.6 / section 5 budget: every 30 s while the tab is visible (TanStack pauses intervals
    // while hidden), and not at all once every request is decided.
    refetchInterval: (query) => (query.state.data?.some((r) => r.status === "pending") ? STATUS_POLL_MS : false),
    refetchOnWindowFocus: true,
  });
  const requestable = useQuery({
    queryKey: REQUESTABLE_KEY,
    queryFn: async () => requestableProjectsResponse.parse(await api("/api/projects/requestable")).projects,
  });

  // An approval makes a Pending person Active: refresh who they are so they can move on to My Work.
  const approved = mine.data?.some((r) => r.status === "approved") ?? false;
  useEffect(() => {
    if (approved && me.user.status === "pending") void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [approved, me.user.status, queryClient]);

  const requests = mine.data ?? [];
  const showForm = choosing || (mine.isSuccess && requests.length === 0);

  const content = mine.isError || requestable.isError ? (
    <ErrorState
      title="We couldn't load your requests."
      description="Check your connection and try again."
      onRetry={() => {
        void mine.refetch();
        void requestable.refetch();
      }}
    />
  ) : showForm ? (
    <RequestForm
      me={me}
      projects={requestable.data}
      onCancel={requests.length > 0 ? () => setChoosing(false) : undefined}
      onSubmitted={() => setChoosing(false)}
    />
  ) : (
    mine.isSuccess && (
      <StatusList me={me} requests={requests} canRequestMore={(requestable.data?.length ?? 0) > 0} onRequestMore={() => setChoosing(true)} />
    )
  );

  // Inside the shell the account, My Work and sign-out are already in the navigation. The form and the status
  // list carry the page's one h1.
  if (inShell) return <div className="mx-auto flex w-full max-w-2xl flex-col gap-group px-4 py-8 md:px-8">{content}</div>;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-12">
      <div className="flex items-center gap-4">
        {me.user.avatarUrl && (
          <img src={me.user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-12 rounded-full bg-hover" />
        )}
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-ink">{me.user.name}</p>
          <p className="truncate text-secondary text-ink-2">{me.user.email}</p>
        </div>
      </div>

      {content}

      <div className="flex flex-wrap items-center gap-4">
        {me.user.status === "active" && (
          <Link to="/work" className="text-accent-ink underline-offset-4 hover:underline">
            Back to My Work
          </Link>
        )}
        <Button
          variant="ghost"
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

function RequestForm({
  me,
  projects,
  onCancel,
  onSubmitted,
}: {
  me: MeResponse;
  projects: ProjectTile[] | undefined;
  onCancel?: () => void;
  onSubmitted: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPickError, setShowPickError] = useState(false);

  const submit = useMutation({
    mutationFn: () =>
      api("/api/access-requests", { body: { projectIds: [...selected], note }, csrfToken: me.csrfToken }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MINE_KEY }),
        queryClient.invalidateQueries({ queryKey: REQUESTABLE_KEY }),
      ]);
      onSubmitted();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === ACCESS_ERRORS.rateLimited) setError(ACCESS_COPY.rateLimited);
      else {
        // A project may have just been requested or hidden; show the current list.
        if (err instanceof ApiError && err.code === ACCESS_ERRORS.alreadyRequested) {
          void queryClient.invalidateQueries({ queryKey: REQUESTABLE_KEY });
        }
        setError(FAILED);
      }
    },
  });

  function toggle(id: number) {
    setShowPickError(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (selected.size === 0) {
      setShowPickError(true);
      return;
    }
    submit.mutate();
  }

  if (projects && projects.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-title">Request access</h1>
        <p className="text-body text-ink">
          There are no projects to request right now. Contact an admin at{" "}
          <a className="text-accent-ink underline-offset-4 hover:underline" href={`mailto:${AUTH_COPY.contactEmail}`}>
            {AUTH_COPY.contactEmail}
          </a>
          .
        </p>
        {onCancel && (
          <div>
            <Button variant="secondary" onClick={onCancel}>
              Back to my requests
            </Button>
          </div>
        )}
      </section>
    );
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-2">
        <h1 className="text-title">Request access</h1>
        <p className="text-body text-ink-2">Choose the projects you'd like to join. A team admin will review your request.</p>
      </div>

      <fieldset className="flex flex-col gap-3" aria-describedby={showPickError ? "pick-error" : undefined}>
        <legend className="mb-3 text-secondary font-medium text-ink">Projects</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(projects ?? []).map((p) => {
            const checked = selected.has(p.id);
            return (
              <label
                key={p.id}
                className={cn(
                  "flex min-h-touch cursor-pointer items-start gap-3 rounded-card border bg-card p-4",
                  "transition-colors duration-(--duration-micro) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                  checked ? "border-accent bg-accent-soft" : "border-line state-hover:bg-hover",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-(--accent)"
                  checked={checked}
                  onChange={() => toggle(p.id)}
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-body font-medium text-ink">{p.name}</span>
                  {p.description && <span className="text-secondary text-ink-2">{p.description}</span>}
                </span>
              </label>
            );
          })}
        </div>
        {showPickError && (
          <p id="pick-error" role="alert" className="text-secondary text-danger-ink">
            Choose at least one project.
          </p>
        )}
      </fieldset>

      <Field label="Note (optional)" hint="A sentence about how you'd like to help.">
        <Textarea value={note} maxLength={NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {error && (
        <p role="alert" className="rounded-card border border-danger-line bg-danger-soft px-4 py-3 text-secondary text-ink">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={submit.isPending}>
          Request access
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

const STATUS_CHIP: Record<MyAccessRequest["status"], { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  denied: { label: "Denied", tone: "error" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

function StatusList({
  me,
  requests,
  canRequestMore,
  onRequestMore,
}: {
  me: MeResponse;
  requests: MyAccessRequest[];
  canRequestMore: boolean;
  onRequestMore: () => void;
}) {
  const anyPending = requests.some((r) => r.status === "pending");
  const anyDenied = requests.some((r) => r.status === "denied");
  return (
    <section className="flex flex-col gap-4" aria-labelledby="status-heading">
      <h1 id="status-heading" className="text-title">
        Your access requests
      </h1>
      {anyPending && <p className="text-body text-ink-2">{ACCESS_COPY.reviewPromise}</p>}
      {/* Polite live region: chips change as admins decide, without a manual refresh. */}
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card" aria-live="polite">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-body font-medium text-ink">{r.project.name}</span>
              <Badge tone={STATUS_CHIP[r.status].tone}>{STATUS_CHIP[r.status].label}</Badge>
            </div>
            {r.status === "denied" && r.decisionReason && (
              <p className="text-secondary text-ink-2">
                <span className="font-medium text-ink">Reason: </span>
                {r.decisionReason}
              </p>
            )}
            {r.stillWaiting && <Nudge me={me} request={r} />}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        {me.user.status === "active" && !anyPending && (
          <Link
            to="/work"
            className="inline-flex min-h-touch items-center rounded-control bg-accent px-4 text-secondary font-medium text-on-accent state-hover:bg-accent-hover"
          >
            Go to My Work
          </Link>
        )}
        {canRequestMore && (
          <Button variant="secondary" onClick={onRequestMore}>
            {anyDenied ? "Request a different project" : "Request another project"}
          </Button>
        )}
      </div>
    </section>
  );
}

/** AUTH-8: after 48 hours, one reminder to the project admin per 24 hours. */
function Nudge({ me, request }: { me: MeResponse; request: MyAccessRequest }) {
  const queryClient = useQueryClient();
  const nudge = useMutation({
    mutationFn: () => api(`/api/access-requests/${request.id}/nudge`, { method: "POST", csrfToken: me.csrfToken }),
    onSuccess: async () => {
      toast({ variant: "success", title: "Reminder sent." });
      await queryClient.invalidateQueries({ queryKey: MINE_KEY });
    },
    onError: () => toast({ variant: "error", title: FAILED }),
  });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-secondary text-ink">{ACCESS_COPY.stillWaiting}</p>
      <Button
        variant="secondary"
        icon={BellRing}
        disabled={!request.canNudge}
        loading={nudge.isPending}
        onClick={() => nudge.mutate()}
      >
        {request.canNudge ? "Send reminder" : "Reminder sent"}
      </Button>
    </div>
  );
}
