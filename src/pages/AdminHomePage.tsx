import { ChevronRight, Lock } from "lucide-react";
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ADMIN_GROUPS, adminLinks, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Icon } from "../components/ui/Icon";
import { EmptyState } from "../components/ui/States";

// The admin area's front door (section 11.12): every admin tool in one place, grouped by what it's for,
// each with one line on what it does. The admin area's own sidebar (AppShell) mirrors these groups.

const GROUP_INTRO = {
  People: "Who can use the hub and what they can do.",
  Projects: "The teams' projects and how they're going.",
  System: "Records, limits and data housekeeping.",
} as const;

export function AdminHomePage() {
  const me = useMe();
  const links = adminLinks(me);
  return (
    <PageLayout title="Administration" intro="Everything for running the hub, in one place.">
      {links.length === 0 ? (
        <EmptyState icon={Lock} title="Only project and app admins can see this area." />
      ) : (
        ADMIN_GROUPS.map((group) => {
          const items = links.filter((l) => l.group === group);
          if (items.length === 0) return null;
          const id = `admin-group-${group.toLowerCase()}`;
          return (
            <section key={group} aria-labelledby={id} className="flex flex-col gap-3">
              <div>
                <h2 id={id} className="text-body font-semibold text-ink">
                  {group}
                </h2>
                <p className="text-secondary text-ink-2">{GROUP_INTRO[group]}</p>
              </div>
              <ul className="stagger grid gap-3 sm:grid-cols-2">
                {items.map((item, i) => (
                  <li key={item.to} style={{ "--i": i } as CSSProperties}>
                    <Link
                      to={item.to}
                      className="lift group flex h-full items-start gap-4 rounded-card border border-line bg-card p-component shadow-raised state-hover:border-accent"
                    >
                      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent-ink">
                        <Icon icon={item.icon} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-body font-semibold text-ink">{item.label}</span>
                        <span className="text-secondary text-ink-2">{item.description}</span>
                      </span>
                      <Icon icon={ChevronRight} className="mt-2 text-ink-2 transition-transform duration-(--duration-micro) ease-out group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </PageLayout>
  );
}
