import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { MeResponse } from "../../shared/auth";
import { describeNotification, NOTIFICATION_COPY, type NotificationItem, notificationHref, UNREAD_CAP } from "../../shared/notifications";
import { cn } from "../lib/cn";
import { relativeTime, useBell, useMarkRead, useUnread } from "../lib/notifications";
import { Avatar } from "./ui/Avatar";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/Menu";
import { Skeleton } from "./ui/Skeleton";
import { Tooltip } from "./ui/Tooltip";

// The bell (NOTIF-4, section 11.8): unread badge (max "99+"), a dropdown of the 20 newest from the last
// 30 days, mark one or all read, and "View all" for the full page.

export function badgeText(n: number): string {
  return n >= UNREAD_CAP ? "99+" : String(n);
}

export function NotificationRow({ n, onOpen }: { n: NotificationItem; onOpen: (n: NotificationItem) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        className="flex w-full items-start gap-3 rounded-control px-2 py-2 text-left state-hover:bg-hover"
      >
        <Avatar name={n.actor?.name ?? "Hub"} url={n.actor?.avatarUrl ?? null} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("text-secondary text-ink", !n.read && "font-medium")}>{describeNotification(n)}</span>
          <span className="text-caption text-ink-2">{relativeTime(n.createdAt)}</span>
        </span>
        {/* Unread: a blue dot, and words for screen readers (never colour alone). */}
        {!n.read && (
          <>
            <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-accent" />
            <span className="sr-only">Unread</span>
          </>
        )}
      </button>
    </li>
  );
}

export function NotificationBell({ me, side = "bottom" }: { me: MeResponse; side?: "bottom" | "right" }) {
  const [open, setOpen] = useState(false);
  const bell = useBell();
  const unread = useUnread() ?? bell.data?.unread ?? 0;
  const markRead = useMarkRead(me.csrfToken);
  const navigate = useNavigate();
  const label = unread > 0 ? `Notifications, ${badgeText(unread)} unread` : "Notifications";

  function openItem(n: NotificationItem) {
    setOpen(false);
    if (!n.read) markRead.mutate(n.id);
    navigate(notificationHref(n));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Notifications">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="relative inline-flex size-touch shrink-0 items-center justify-center rounded-control text-ink state-hover:bg-hover"
          >
            <Icon icon={Bell} />
            {unread > 0 && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-0.5 min-w-5 rounded-full bg-accent px-1 text-center text-label leading-5 text-on-accent tabular-nums"
              >
                {badgeText(unread)}
              </span>
            )}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side={side} align="end" aria-label="Notifications" className="flex w-96 flex-col gap-2 p-2">
        <div className="flex items-center justify-between gap-2 px-2 pt-1">
          <h2 className="text-body font-semibold text-ink">Notifications</h2>
          <Button variant="ghost" icon={CheckCheck} disabled={unread === 0} loading={markRead.isPending && markRead.variables === "all"} onClick={() => markRead.mutate("all")}>
            Mark all as read
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {bell.isPending ? (
            <div aria-busy="true" aria-label="Loading notifications" className="flex flex-col gap-2 p-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : bell.isError ? (
            <p className="p-3 text-secondary text-danger-ink">We couldn't load notifications. Check your connection and try again.</p>
          ) : bell.data.items.length === 0 ? (
            <p className="p-6 text-center text-secondary text-ink-2">{NOTIFICATION_COPY.empty}</p>
          ) : (
            <ul className="flex flex-col">
              {bell.data.items.map((n) => (
                <NotificationRow key={n.id} n={n} onOpen={openItem} />
              ))}
            </ul>
          )}
        </div>
        <Link
          to="/notifications"
          onClick={() => setOpen(false)}
          className="flex min-h-touch items-center justify-center rounded-control text-secondary text-accent-ink state-hover:bg-hover"
        >
          View all
        </Link>
      </PopoverContent>
    </Popover>
  );
}
