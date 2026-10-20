import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Select } from "../components/ui/choices";
import { Field } from "../components/ui/Field";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { ErrorState } from "../components/ui/States";
import { toast } from "../components/ui/Toast";
import { api } from "../lib/api";

// NOTIF-5: each email instant, in the 7 am digest, or off, and the timezone the digest follows (section 8).
// The bell isn't affected; these settings only shape email.

const QUERY_KEY = ["notification-settings"];
const SAVE_FAILED = "We couldn't save this change. Check your connection and try again.";
const MODE_OPTIONS: { value: EmailMode; label: string }[] = [
  { value: "instant", label: "Email right away" },
  { value: "digest", label: "In the 7 am digest" },
  { value: "off", label: "Off" },
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

  return (
    <PageLayout title="Email settings" intro="Choose which emails you get and when. The notification bell in the app always shows everything.">
      {settings.isPending ? (
        <div aria-busy="true" aria-label="Loading email settings" className="flex flex-col gap-3">
          {showSkeleton && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : settings.isError ? (
        <ErrorState title="We couldn't load your email settings." description="Check your connection and try again." onRetry={() => void settings.refetch()} retrying={settings.isFetching} />
      ) : (
        <div className="flex flex-col gap-group">
          <section aria-labelledby="digest-heading" className="flex flex-col gap-3 rounded-card border border-line bg-card p-4">
            <h2 id="digest-heading" className="text-body font-semibold text-ink">
              Morning digest
            </h2>
            <Field label="Your timezone" hint="The digest arrives at 7 am in this timezone.">
              <Select
                options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))}
                value={settings.data.timezone}
                onValueChange={(timezone) => save.mutate({ timezone })}
              />
            </Field>
          </section>
          <section aria-labelledby="events-heading" className="flex flex-col gap-3 rounded-card border border-line bg-card p-4">
            <h2 id="events-heading" className="text-body font-semibold text-ink">
              Emails
            </h2>
            <ul className="flex flex-col divide-y divide-line">
              {visible.map((e) => (
                <li key={e.type} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="sm:max-w-sm sm:flex-1">
                    <Field label={NOTIFICATION_EVENTS[e.type].label}>
                      <Select
                        options={MODE_OPTIONS}
                        value={e.mode}
                        onValueChange={(mode) => save.mutate({ events: { [e.type]: mode as EmailMode } })}
                      />
                    </Field>
                  </div>
                  {e.mode !== e.defaultMode && (
                    <p className="text-caption text-ink-2">Usually {MODE_OPTIONS.find((o) => o.value === e.defaultMode)!.label.toLowerCase()}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </PageLayout>
  );
}
