import { NavLink } from "react-router";
import type { MeResponse } from "../../../shared/auth";
import { cn } from "../../lib/cn";
import { Icon } from "../ui/Icon";
import { adminLinks } from "./AppShell";

/** Switches between admin pages. Shown only when the person has more than one (on mobile it's the only way). */
export function AdminTabs({ me }: { me: MeResponse }) {
  const links = adminLinks(me);
  if (links.length < 2) return null;
  return (
    <nav aria-label="Admin" className="-mt-2 flex gap-1 overflow-x-auto border-b border-line">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) =>
            cn(
              "-mb-px inline-flex min-h-touch shrink-0 items-center gap-2 border-b-2 px-3 text-secondary",
              "transition-colors duration-(--duration-menu) ease-out",
              isActive ? "border-accent font-medium text-accent-ink" : "border-transparent text-ink-2 state-hover:text-ink",
            )
          }
        >
          <Icon icon={link.icon} />
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
