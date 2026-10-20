import { useMutation, useQuery } from "@tanstack/react-query";
import { Bug, Inbox, Lightbulb, Send } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ATTACHMENT_COPY, ATTACHMENT_MAX_BYTES, FILENAME_HEADER } from "../../shared/attachments";
import { CSRF_HEADER } from "../../shared/auth";
import { FEEDBACK_COPY, FEEDBACK_ERRORS, FEEDBACK_TEXT_MAX, feedbackCreated, myFeedbackResponse } from "../../shared/feedback";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { OfflineDisabled } from "../components/StatusBanners";
import { Badge } from "../components/ui/Badge";
import { Button, buttonClasses } from "../components/ui/Button";
import { Field, useFieldControl } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { Textarea, TextInput } from "../components/ui/inputs";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { toast } from "../components/ui/Toast";
import { api, ApiError } from "../lib/api";
import { useOnline } from "../lib/online";

// Report a Bug (FDBK-2) and Request a Feature (FDBK-3): both land in Hub Feedback (FDBK-4), and the
// submitter's own items are listed here with their status (FDBK-5). RATE-3 caps it at 20 a day.

const FAILED = "That didn't go through. Check your connection and try again.";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** The page the person came from: the Help menu passes it along (FDBK-2 "page captured automatically"). */
function useFromPage(): string {
  const location = useLocation();
  return (location.state as { from?: string } | null)?.from ?? document.referrer ?? "";
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError && err.code === FEEDBACK_ERRORS.rateLimited ? FEEDBACK_COPY.rateLimited : FAILED;
}

function FormShell({ title, intro, error, pending, submitLabel, onSubmit, children }: {
  title: string;
  intro: string;
  error: string | null;
  pending: boolean;
  submitLabel: string;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  const online = useOnline();
  return (
    <PageLayout title={title} intro={intro}>
      <form className="flex flex-col gap-4 rounded-card border border-line bg-card p-4" onSubmit={onSubmit} noValidate>
        {children}
        <p className="text-caption text-ink-2">{ATTACHMENT_COPY.dataSafety}</p>
        {error && (
          <p role="alert" className="rounded-control bg-danger-soft p-3 text-secondary text-danger-ink">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {online ? (
            <Button type="submit" icon={Send} loading={pending}>
              {submitLabel}
            </Button>
          ) : (
            <OfflineDisabled label={submitLabel} icon={Send} />
          )}
          <Link to="/feedback" className="text-secondary font-medium text-accent-ink underline">
            Your feedback
          </Link>
        </div>
      </form>
    </PageLayout>
  );
}

async function uploadScreenshot(id: number, file: File, csrfToken: string) {
  const res = await fetch(`/api/feedback/${id}/screenshot`, {
    method: "POST",
    headers: { [CSRF_HEADER]: csrfToken, [FILENAME_HEADER]: encodeURIComponent(file.name) },
    body: file,
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error("upload failed");
}

/** Inside its <Field>, so the label and hint are wired to it. */
function ScreenshotInput({ onChange }: { onChange: (file: File | null) => void }) {
  const field = useFieldControl();
  return (
    <input
      {...field}
      type="file"
      accept={IMAGE_TYPES.join(",")}
      onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      className="text-secondary text-ink file:mr-3 file:min-h-touch file:rounded-control file:border file:border-line file:bg-card file:px-3 file:text-secondary file:text-ink"
    />
  );
}

export function BugReportPage() {
  const me = useMe();
  const navigate = useNavigate();
  const page = useFromPage();
  const [whatHappened, setWhatHappened] = useState("");
  const [expected, setExpected] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ whatHappened?: string; expected?: string; screenshot?: string }>({});

  const send = useMutation({
    mutationFn: async () => {
      const created = feedbackCreated.parse(
        await api("/api/feedback/bug", { body: { whatHappened, expected, page, browser: navigator.userAgent }, csrfToken: me.csrfToken }),
      );
      // The report is in even if the screenshot fails; say so rather than losing it.
      if (screenshot) await uploadScreenshot(created.id, screenshot, me.csrfToken).catch(() => toast({ variant: "warning", title: "Your report was sent, but the screenshot didn't upload." }));
      return created;
    },
    onSuccess: () => {
      toast({ variant: "success", title: FEEDBACK_COPY.bugSent });
      navigate("/feedback");
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!whatHappened.trim()) next.whatHappened = "Tell us what happened.";
    if (!expected.trim()) next.expected = "Tell us what you expected.";
    if (screenshot && screenshot.size > ATTACHMENT_MAX_BYTES) next.screenshot = ATTACHMENT_COPY.tooLarge;
    else if (screenshot && !IMAGE_TYPES.includes(screenshot.type)) next.screenshot = "Choose an image (PNG, JPEG, GIF or WebP).";
    setErrors(next);
    if (Object.keys(next).length === 0) send.mutate();
  }

  return (
    <FormShell
      title="Report a bug"
      intro="Something not working? Tell us and an app administrator will look into it."
      error={send.isError ? errorMessage(send.error) : null}
      pending={send.isPending}
      submitLabel="Send report"
      onSubmit={submit}
    >
      <Field label="What happened?" error={errors.whatHappened} required>
        <Textarea rows={4} maxLength={FEEDBACK_TEXT_MAX} value={whatHappened} onChange={(e) => setWhatHappened(e.target.value)} />
      </Field>
      <Field label="What did you expect to happen?" error={errors.expected} required>
        <Textarea rows={3} maxLength={FEEDBACK_TEXT_MAX} value={expected} onChange={(e) => setExpected(e.target.value)} />
      </Field>
      <Field label="Screenshot" hint="Optional. One image, up to 10 MB." error={errors.screenshot}>
        <ScreenshotInput onChange={setScreenshot} />
      </Field>
      <p className="text-caption text-ink-2">We'll also include the page you were on{page ? ` (${page})` : ""} and your browser, to help track it down.</p>
    </FormShell>
  );
}

export function FeatureRequestPage() {
  const me = useMe();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [why, setWhy] = useState("");
  const [errors, setErrors] = useState<{ title?: string; description?: string; why?: string }>({});
  const send = useMutation({
    mutationFn: async () => feedbackCreated.parse(await api("/api/feedback/feature", { body: { title, description, why }, csrfToken: me.csrfToken })),
    onSuccess: () => {
      toast({ variant: "success", title: FEEDBACK_COPY.featureSent });
      navigate("/feedback");
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!title.trim()) next.title = "Give your idea a short title.";
    if (!description.trim()) next.description = "Describe your idea.";
    if (!why.trim()) next.why = "Tell us why it matters.";
    setErrors(next);
    if (Object.keys(next).length === 0) send.mutate();
  }

  return (
    <FormShell
      title="Request a feature"
      intro="Have an idea that would make the hub better? We'd love to hear it."
      error={send.isError ? errorMessage(send.error) : null}
      pending={send.isPending}
      submitLabel="Send idea"
      onSubmit={submit}
    >
      <Field label="Title" error={errors.title} required>
        <TextInput maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Description" error={errors.description} required>
        <Textarea rows={4} maxLength={FEEDBACK_TEXT_MAX} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Why does it matter?" hint="Who it helps and how often it comes up." error={errors.why} required>
        <Textarea rows={3} maxLength={FEEDBACK_TEXT_MAX} value={why} onChange={(e) => setWhy(e.target.value)} />
      </Field>
    </FormShell>
  );
}

export function MyFeedbackPage() {
  const me = useMe();
  const location = useLocation();
  const list = useQuery({ queryKey: ["feedback", "mine"], queryFn: async () => myFeedbackResponse.parse(await api("/api/feedback/mine")) });
  const showSkeleton = useDelayedFlag(list.isPending);
  const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: me.user.timezone });
  const from = { from: (location.state as { from?: string } | null)?.from };
  return (
    <PageLayout
      title="Your feedback"
      intro="Bug reports and ideas you've sent, and where each one stands. We'll email you when one changes."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/feedback/bug" state={from} className={buttonClasses("secondary")}>
            Report a bug
          </Link>
          <Link to="/feedback/feature" state={from} className={buttonClasses("secondary")}>
            Request a feature
          </Link>
        </div>
      }
    >
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading your feedback" className="flex flex-col gap-2">
          {showSkeleton && [0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : list.isError ? (
        <ErrorState title="We couldn't load your feedback." description="Check your connection and try again." onRetry={() => void list.refetch()} retrying={list.isFetching} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={Inbox} title="You haven't sent any feedback yet." />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
          {list.data.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className="text-ink-2" aria-hidden="true">
                <Icon icon={item.kind === "bug" ? Bug : Lightbulb} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body font-medium text-ink">
                  <span className="sr-only">{item.kind === "bug" ? "Bug report: " : "Idea: "}</span>
                  {item.title}
                </span>
                <span className="text-caption text-ink-2">
                  {item.key} · sent {dateFormat.format(item.createdAt)}
                </span>
              </div>
              <Badge tone={item.done ? "success" : "neutral"}>{item.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </PageLayout>
  );
}
