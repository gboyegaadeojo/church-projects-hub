import { useMutation } from "@tanstack/react-query";
import { MailX } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { NOTIFICATION_EVENTS, type NotificationType, UNSUBSCRIBE_COPY } from "../../shared/notifications";
import { Button } from "../components/ui/Button";
import { api } from "../lib/api";

// NOTIF-6: where an email's unsubscribe link lands. No sign-in needed; one button confirms, so a mail scanner
// that opens links can't unsubscribe anyone by itself.

function describe(event: string | null): string | null {
  if (event === "digest") return "the 7 am digest";
  if (event && event in NOTIFICATION_EVENTS) return `“${NOTIFICATION_EVENTS[event as NotificationType].label}” emails`;
  return null;
}

export function UnsubscribePage() {
  const [params] = useSearchParams();
  const what = describe(params.get("e"));
  const unsubscribe = useMutation({
    mutationFn: () => api(`/api/unsubscribe?${params.toString()}`, { method: "POST" }),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <p className="text-secondary font-medium text-ink-2">Church Projects Hub</p>
      {!what || unsubscribe.isError ? (
        <>
          <h1 className="text-title">Unsubscribe</h1>
          <p role={unsubscribe.isError ? "alert" : undefined} className="text-body text-ink-2">
            {UNSUBSCRIBE_COPY.invalid}
          </p>
        </>
      ) : unsubscribe.isSuccess ? (
        <>
          <h1 className="text-title">{UNSUBSCRIBE_COPY.done}</h1>
          <p role="status" className="text-body text-ink-2">
            You won't get {what} any more. You can turn them back on in your email settings.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-title">Unsubscribe from {what}?</h1>
          <p className="text-body text-ink-2">Other emails and the notification bell aren't affected.</p>
          <div>
            <Button icon={MailX} loading={unsubscribe.isPending} onClick={() => unsubscribe.mutate()}>
              Unsubscribe
            </Button>
          </div>
        </>
      )}
      <Link to="/settings/notifications" className="text-secondary font-medium text-accent-ink underline">
        Email settings
      </Link>
    </main>
  );
}
