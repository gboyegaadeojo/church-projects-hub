import { useInfiniteQuery } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router";
import { NOTIFICATION_COPY, type NotificationItem, notificationHref, notificationsResponse } from "../../shared/notifications";
import { NotificationRow } from "../components/NotificationBell";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Button } from "../components/ui/Button";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { api } from "../lib/api";
import { setUnread, useMarkRead, useUnread } from "../lib/notifications";

// All notifications, newest first, 30 at a time (section 11.8 "View all"), including those older than 30 days.

export function NotificationsPage() {
  const me = useMe();
  const navigate = useNavigate();
  const markRead = useMarkRead(me.csrfToken);
  const unread = useUnread() ?? 0;
  const list = useInfiniteQuery({
    queryKey: ["notifications", "all"],
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) => {
      const data = notificationsResponse.parse(await api(`/api/notifications?limit=30${pageParam ? `&before=${pageParam}` : ""}`));
      setUnread(data.unread);
      return data;
    },
    getNextPageParam: (last) => last.nextBefore,
  });
  const showSkeleton = useDelayedFlag(list.isPending);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  function open(n: NotificationItem) {
    if (!n.read) markRead.mutate(n.id);
    navigate(notificationHref(n));
  }

  return (
    <PageLayout
      title="Notifications"
      actions={
        <Button variant="secondary" icon={CheckCheck} disabled={unread === 0} onClick={() => markRead.mutate("all")}>
          Mark all as read
        </Button>
      }
    >
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading notifications" className="flex flex-col gap-2">
          {showSkeleton && [0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : list.isError ? (
        <ErrorState title="We couldn't load your notifications." description="Check your connection and try again." onRetry={() => void list.refetch()} retrying={list.isFetching} />
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title={NOTIFICATION_COPY.empty} />
      ) : (
        <>
          <ul className="flex flex-col rounded-card border border-line bg-card p-2">
            {items.map((n) => (
              <NotificationRow key={n.id} n={n} onOpen={open} />
            ))}
          </ul>
          {list.hasNextPage && (
            <Button variant="secondary" className="self-center" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Show older
            </Button>
          )}
        </>
      )}
    </PageLayout>
  );
}
