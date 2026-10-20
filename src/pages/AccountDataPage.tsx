import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { DELETION_CONFIRM, DELETION_COPY, myDeletionResponse } from "../../shared/admin";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Skeleton } from "../components/ui/Skeleton";
import { ErrorState } from "../components/ui/States";
import { api } from "../lib/api";

// ADM-6: a person asks for their data to be deleted. An App Admin reviews it (target: within 30 days).

const QUERY_KEY = ["me", "deletion-request"];

export function AccountDataPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const request = useQuery({ queryKey: QUERY_KEY, queryFn: async () => myDeletionResponse.parse(await api("/api/me/deletion-request")).request });
  const [confirming, setConfirming] = useState(false);
  const date = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: me.user.timezone });
  const pending = request.data?.status === "pending";

  return (
    <PageLayout title="Your data" intro="We keep only your name, email address and Google profile picture, plus the work you do here.">
      <section aria-labelledby="delete-heading" className="flex flex-col gap-3 rounded-card border border-line bg-card p-4">
        <h2 id="delete-heading" className="text-body font-semibold text-ink">
          Delete my data
        </h2>
        <p className="text-secondary text-ink-2">
          If it's approved, your name, email address and picture are replaced with "Deleted User" and a number, and you're signed out for good. Tasks and comments
          you wrote stay, under that name, so your team's history still makes sense.
        </p>
        {request.isError ? (
          <ErrorState title="We couldn't check your request." description="Check your connection and try again." onRetry={() => void request.refetch()} retrying={request.isFetching} />
        ) : request.isPending ? (
          <Skeleton className="h-10 w-48" />
        ) : pending ? (
          <p role="status" className="text-secondary text-ink">
            You asked on {date.format(request.data!.requestedAt)}. {DELETION_COPY.requested}
          </p>
        ) : (
          <>
            {request.data?.status === "rejected" && (
              <p className="text-secondary text-ink-2">Your last request was declined. You can ask again, or contact an app administrator.</p>
            )}
            <div>
              <Button variant="destructive" icon={Trash2} onClick={() => setConfirming(true)}>
                Request deletion
              </Button>
            </div>
          </>
        )}
      </section>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Ask to delete your data?"
        description="An app admin will review it. Once approved it can't be undone."
        confirmLabel="Request deletion"
        confirmIcon={Trash2}
        confirmAction={DELETION_CONFIRM.request}
        successMessage="Request sent."
        onConfirm={async (headers) => {
          await api("/api/me/deletion-request", { method: "POST", csrfToken: me.csrfToken, headers });
          await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
          setConfirming(false);
        }}
      />
    </PageLayout>
  );
}
