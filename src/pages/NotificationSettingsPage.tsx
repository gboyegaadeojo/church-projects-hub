import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Clock, Inbox, type LucideIcon, Mail, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useMemo } from "react";
import {
  APP_ADMIN_EVENTS,
  DECIDER_EVENTS,
  type EmailMode,
  NOTIFICATION_EVENTS,
  type NotificationSettings,
  notificationSettingsResponse,
  type NotificationType,
} from "../../shared/notifications";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/choices";
import { Field } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { ErrorState } from "../components/ui/States";
import { toast } from "../components/ui/Toast";
import { api } from "../lib/api";
import { cn } from "../lib/cn";

// NOTIF-5 (v4.6 layout): every email at a glance. A summary of what arrives when, one-click presets, the digest's
// timezone with the time there now, and each email grouped by what it's about with a three-way switch: right away,
// in the 7 am digest, or off. The bell isn't affected; these settings only shape email.

const QUERY_KEY = ["notification-settings"];
const SAVE_FAILED = "We couldn't save this change. Check your connection and try again.";
const MODES: { value: EmailMode; label: string; icon: LucideIcon }[] = [
  { value: "instant", label: "Right away", icon: Zap },
  { value: "digest", label: "Digest", icon: Clock },
  { value: "off", label: "Off", icon: BellOff },
];
const MODE_WORDS: Record<EmailMode, string> = { instant: "right away", digest: "in the 7 am digest", off: "off" };

/** What each email is for, in a sentence. */
const DESCRIPTIONS: Partial<Record<NotificationType, string>> = {
  "task.assigned": "When someone makes you the assignee or secondary assignee.",
  "task.mentioned": "When someone writes @your name in a task or comment.",
  "task.commented": "New comments on tasks you're on or follow.",
  "task.status_changed": "When a task you reported moves to another column.",
  "task.blocked": "When a task you're assigned to or reported is blocked, with the reason.",
  "task.due_soon": "A week before your task is due.",
  "task.due_tomorrow": "The day before your task is due.",
  "task.overdue": "Once, the day after a task of yours was due.",
  "access.requested": "So you can approve or deny people quickly.",
  "access.nudge": "When someone waiting to join asks again.",
  "access.decided": "Whether you've been let into a project you asked for.",
  "feedback.status_changed": "Progress on a bug you reported or an idea you suggested.",
  "access.reminder": "Requests no one has answered in 3 days.",
};

const GROUPS: { title: string; types: NotificationType[] }[] = [
  { title: "Your tasks", types: ["task.assigned", "task.mentioned", "task.commented", "task.status_changed", "task.blocked"] },
  { title: "Due dates", types: ["task.due_soon", "task.due_tomorrow", "task.overdue"] },
  { title: "Projects you run", types: ["access.requested", "access.nudge"] },
  { title: "Your requests and feedback", types: ["access.decided", "feedback.status_changed"] },
  { title: "App admin", types: ["access.reminder"] },
];

function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = ["America/Winnipeg"];
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

function timeIn(zone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(Date.now());
  } catch {
    return "";
  }
}

export function NotificationSettingsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => notificationSettingsResponse.parse(await api("/api/me/notification-settings")),
  });
  const showSkeleton = useDelayedFlag(settings.isPending);

  const save = useMutation({
    mutationFn: (body: { timezone?: string; events?: Partial<Record<NotificationType, EmailMode>> }) =>
      api("/api/me/notification-settings", { method: "PUT", body, csrfToken: me.csrfToken }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<NotificationSettings>(QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<NotificationSettings>(QUERY_KEY, {
          timezone: body.timezone ?? previous.timezone,
          events: previous.events.map((e) => ({ ...e, mode: body.events?.[e.type] ?? e.mode })),
        });
      }
      return { previous };
    },
    onSuccess: () => toast({ variant: "success", title: "Saved." }),
    onError: (_err, _body, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
      toast({ variant: "error", title: SAVE_FAILED });
    },
  });

  const visible = useMemo(
    () =>
      (settings.data?.events ?? []).filter(
        (e) => (!DECIDER_EVENTS.includes(e.type) || me.canReviewAccess) && (!APP_ADMIN_EVENTS.includes(e.type) || me.user.appRole === "admin"),
      ),
    [settings.data, me],
  );
  const zones = useMemo(() => timeZones(settings.data?.timezone ?? "America/Winnipeg"), [settings.data?.timezone]);
  const count = (mode: EmailMode) => visible.filter((e) => e.mode === mode).length;
  const applyAll = (pick: (e: (typeof visible)[number]) => EmailMode) => save.mutate({ events: Object.fromEntries(visible.map((e) => [e.type, pick(e)])) });

  return (
    <PageLayout title="Email settings" intro="Choose which emails you get and when. The notification bell in the app always shows everything.">
      {settings.isPending ? (
        <div aria-busy="true" aria-label="Loading email settings" className="flex flex-col gap-3">
          {showSkeleton && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : settings.isError ? (
        <ErrorState title="We couldn't load your email settings." description="Check your connection and try again." onRetry={() => void settings.refetch()} retrying={settings.isFetching} />
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-labelledby="summary-heading" className="flex flex-col gap-4 rounded-card border border-line bg-linear-120 from-hero-from to-hero-to p-5">
            <h2 id="summary-heading" className="sr-only">
              Summary
            </h2>
            <dl className="grid grid-cols-3 gap-3">
              <Count icon={Zap} tone="bg-vivid-blue" label="Right away" value={count("instant")} />
              <Count icon={Inbox} tone="bg-vivid-purple" label="In the 7 am digest" value={count("digest")} />
              <Count icon={BellOff} tone="bg-vivid-grey" label="Off" value={count("off")} />
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-secondary text-ink-2">Quick set:</span>
              <Button variant="secondary" icon={Sparkles} onClick={() => applyAll((e) => e.defaultMode)}>
                Recommended
              </Button>
              <Button variant="secondary" icon={Inbox} onClick={() => applyAll((e) => (e.mode === "off" ? "off" : "digest"))}>
                Fewer emails
              </Button>
              <Button variant="secondary" icon={BellOff} onClick={() => applyAll(() => "off")}>
                Pause all
              </Button>
            </div>
            <p className="flex items-start gap-2 text-caption text-ink-2">
              <Icon icon={ShieldCheck} size="sm" className="mt-px" />
              Security emails, like being signed out by an admin, and invites always arrive.
            </p>
          </section>

          <section aria-labelledby="digest-heading" className="flex flex-col gap-3 rounded-card border border-line bg-card p-5 shadow-raised">
            <h2 id="digest-heading" className="flex items-center gap-2 text-body font-semibold text-ink">
              <Icon icon={Clock} className="text-accent-ink" />
              Morning digest
            </h2>
            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,20rem)_1fr]">
              <Field label="Your timezone" filter hint="The digest arrives at 7 am in this timezone.">
                <Select options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} value={settings.data.timezone} onValueChange={(timezone) => save.mutate({ timezone })} />
              </Field>
              <p className="pb-2 text-secondary text-ink-2">It's {timeIn(settings.data.timezone)} there now.</p>
            </div>
          </section>

          {GROUPS.map((group) => {
            const rows = visible.filter((e) => group.types.includes(e.type));
            if (rows.length === 0) return null;
            const id = `group-${group.title.toLowerCase().replace(/\W+/g, "-")}`;
            return (
              <section key={group.title} aria-labelledby={id} className="flex flex-col rounded-card border border-line bg-card px-5 py-3 shadow-raised">
                <h2 id={id} className="flex items-center gap-2 py-2 text-body font-semibold text-ink">
                  <Icon icon={Mail} className="text-accent-ink" />
                  {group.title}
                </h2>
                <ul className="flex flex-col divide-y divide-line">
                  {rows.map((e) => (
                    <li key={e.type} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between md:gap-6">
                      <div className="min-w-0">
                        <p id={`event-${e.type}`} className="text-secondary font-medium text-ink">
                          {NOTIFICATION_EVENTS[e.type].label}
                        </p>
                        <p className="text-caption text-ink-2">
                          {DESCRIPTIONS[e.type]}
                          {e.mode !== e.defaultMode && <span className="ml-1">Usually {MODE_WORDS[e.defaultMode]}.</span>}
                        </p>
                      </div>
                      <ModeSwitch labelledBy={`event-${e.type}`} value={e.mode} onChange={(mode) => save.mutate({ events: { [e.type]: mode } })} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}

function Count({ icon, tone, label, value }: { icon: LucideIcon; tone: string; label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-control bg-card/70 p-3">
      <dt className="flex items-center gap-2 text-caption text-ink-2">
        <span aria-hidden="true" className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-chip text-on-vivid", tone)}>
          <Icon icon={icon} size="sm" />
        </span>
        {label}
      </dt>
      <dd className="text-title text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/** Right away / Digest / Off as one segmented radio group, named by the email it controls. */
function ModeSwitch({ labelledBy, value, onChange }: { labelledBy: string; value: EmailMode; onChange: (mode: EmailMode) => void }) {
  return (
    <RadioGroup.Root
      aria-labelledby={labelledBy}
      value={value}
      onValueChange={(v) => onChange(v as EmailMode)}
      orientation="horizontal"
      className="inline-flex shrink-0 self-start rounded-control border border-line bg-page p-0.5 md:self-auto"
    >
      {MODES.map((m) => (
        <RadioGroup.Item
          key={m.value}
          value={m.value}
          className={cn(
            "inline-flex min-h-touch items-center gap-1.5 rounded-chip px-3 text-secondary text-ink-2",
            "transition-colors duration-(--duration-micro) ease-out state-hover:text-ink",
            "data-[state=checked]:bg-card data-[state=checked]:font-semibold data-[state=checked]:text-accent-ink data-[state=checked]:shadow-raised",
          )}
        >
          <Icon icon={m.icon} size="sm" />
          {m.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
