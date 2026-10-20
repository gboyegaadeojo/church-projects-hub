import { useQuery } from "@tanstack/react-query";
import { Bug, CircleHelp, Inbox, Lightbulb, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { newsUnreadResponse } from "../../shared/feedback";
import { api } from "../lib/api";
import { Icon } from "./ui/Icon";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/Menu";
import { Tooltip } from "./ui/Tooltip";

// The Help menu: What's New (FDBK-1) with its blue dot while something is unread (section 11.9), and the
// feedback forms (FDBK-2, FDBK-3). The dot is checked on load and on focus — no polling (section 5).

export const NEWS_UNREAD_KEY = ["news", "unread"];

export function useNewsUnread() {
  return useQuery({
    queryKey: NEWS_UNREAD_KEY,
    queryFn: async () => newsUnreadResponse.parse(await api("/api/news/unread")).unread,
    staleTime: 5 * 60 * 1000,
  });
}

export const HELP_LINKS = [
  { to: "/whats-new", label: "What's New", icon: Sparkles },
  { to: "/feedback/bug", label: "Report a bug", icon: Bug },
  { to: "/feedback/feature", label: "Request a feature", icon: Lightbulb },
  { to: "/feedback", label: "Your feedback", icon: Inbox },
] as const;

export function HelpMenu({ side = "bottom" }: { side?: "bottom" | "right" }) {
  const [open, setOpen] = useState(false);
  const unread = useNewsUnread().data === true;
  const location = useLocation();
  // The bug form records the page the person was on (FDBK-2).
  const from = location.pathname.startsWith("/feedback") ? undefined : location.pathname + location.search;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Help">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={unread ? "Help, new updates" : "Help"}
            className="relative inline-flex size-touch shrink-0 items-center justify-center rounded-control text-ink state-hover:bg-hover"
          >
            <Icon icon={CircleHelp} />
            {unread && <span aria-hidden="true" className="absolute top-2 right-2 size-2.5 rounded-full bg-accent ring-2 ring-card" />}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side={side} align="end" aria-label="Help" className="flex w-64 flex-col p-1">
        <nav aria-label="Help">
          <ul className="flex flex-col">
            {HELP_LINKS.map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  state={from ? { from } : undefined}
                  onClick={() => setOpen(false)}
                  className="flex min-h-touch items-center gap-3 rounded-control px-3 text-secondary text-ink state-hover:bg-hover"
                >
                  <Icon icon={l.icon} />
                  <span className="flex-1">{l.label}</span>
                  {l.to === "/whats-new" && unread && (
                    <span className="flex items-center gap-1 text-caption text-accent-ink">
                      <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
                      New
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </PopoverContent>
    </Popover>
  );
}
