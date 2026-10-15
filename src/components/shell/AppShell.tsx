import {
  CircleUser,
  FolderKanban,
  FolderPlus,
  House,
  Inbox,
  type LucideIcon,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Shield,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useOutletContext } from "react-router";
import type { MeResponse } from "../../../shared/auth";
import type { ProjectSummary } from "../../../shared/projects";
import { cn } from "../../lib/cn";
import { TABLET_QUERY, useMediaQuery } from "../../lib/media";
import { useSaveTheme } from "../../lib/profile";
import { PROJECT_COLOUR_CLASSES, PROJECT_ICON_COMPONENTS, useMyProjects } from "../../lib/projects";
import { useSignOut } from "../../lib/session";
import { SessionGate } from "../SessionGate";
import { Avatar } from "../ui/Avatar";
import { Button, IconButton } from "../ui/Button";
import { Dialog, SheetContent } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Menu";
import { Skeleton } from "../ui/Skeleton";
import { ThemeSwitch } from "../ui/ThemeSwitch";
import { Tooltip } from "../ui/Tooltip";
import { BrandMark } from "./BrandMark";

// The app shell (section 12): a persistent sidebar on desktop, a collapsible icon rail on tablet and a
// bottom navigation bar on mobile. Only Active members get it; Pending people and the security screens
// (section 11.7) render without any app navigation.

/** The signed-in person, for pages inside the shell. */
export function useMe(): MeResponse {
  return useOutletContext<MeResponse>();
}

export function AppShell() {
  return <SessionGate allow={(me) => me.user.status === "active"}>{(me) => <Shell me={me} />}</SessionGate>;
}

const RAIL_STORAGE_KEY = "cph-sidebar-expanded";

function readExpanded(): boolean {
  try {
    return localStorage.getItem(RAIL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** What the admin area holds for this person. Hiding these links is convenience; the API checks (NFR-1). */
export function adminLinks(me: MeResponse): { to: string; label: string; icon: LucideIcon }[] {
  return [
    ...(me.canReviewAccess ? [{ to: "/admin/requests", label: "Access requests", icon: Inbox }] : []),
    ...(me.user.appRole === "admin" ? [{ to: "/admin/projects", label: "Manage projects", icon: Settings2 }] : []),
  ];
}

function Shell({ me }: { me: MeResponse }) {
  const isTablet = useMediaQuery(TABLET_QUERY);
  const [expanded, setExpanded] = useState(readExpanded);
  const collapsed = isTablet && !expanded;
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const lastPathname = useRef(pathname);

  // Section 13: after navigating, move focus to the new page so keyboard and screen-reader users start there.
  // Compared with the last path, not "first render", so StrictMode's double effect doesn't steal focus on load.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);

  function toggleRail() {
    setExpanded((was) => {
      try {
        localStorage.setItem(RAIL_STORAGE_KEY, was ? "0" : "1");
      } catch {
        // Not remembered, still works for this visit.
      }
      return !was;
    });
  }

  return (
    <div className="min-h-dvh bg-page md:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-elevated px-4 py-3 text-ink shadow-floating focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to content
      </a>
      <Sidebar me={me} collapsed={collapsed} onToggle={isTablet ? toggleRail : undefined} />
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="min-w-0 flex-1 pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] outline-none md:pb-0"
      >
        <Outlet context={me} />
      </main>
      <BottomNav me={me} />
    </div>
  );
}

/* ---------- Sidebar (tablet and desktop) ---------- */

const navItemClasses = (active: boolean, collapsed: boolean) =>
  cn(
    "flex min-h-touch items-center gap-3 rounded-control text-secondary transition-colors duration-(--duration-micro) ease-out",
    collapsed ? "justify-center px-0" : "px-3",
    active ? "bg-accent-soft font-medium text-accent-ink" : "text-ink state-hover:bg-hover",
  );

function SidebarLink({
  to,
  label,
  icon,
  collapsed,
  end,
  leading,
}: {
  to: string;
  label: string;
  icon?: LucideIcon;
  collapsed: boolean;
  end?: boolean;
  /** Replaces the icon (e.g. a project's coloured icon). */
  leading?: ReactNode;
}) {
  const link = (
    <NavLink to={to} end={end} aria-label={collapsed ? label : undefined} className={({ isActive }) => navItemClasses(isActive, collapsed)}>
      {leading ?? (icon && <Icon icon={icon} />)}
      {!collapsed && <span className="min-w-0 truncate">{label}</span>}
    </NavLink>
  );
  return <li>{collapsed ? <Tooltip content={label} side="right">{link}</Tooltip> : link}</li>;
}

export function ProjectGlyph({ project, size = "md" }: { project: Pick<ProjectSummary, "colour" | "icon">; size?: "md" | "sm" }) {
  return <Icon icon={PROJECT_ICON_COMPONENTS[project.icon]} size={size} className={PROJECT_COLOUR_CLASSES[project.colour].text} />;
}

function SectionLabel({ collapsed, children }: { collapsed: boolean; children: string }) {
  return collapsed ? (
    <div role="separator" className="mx-3 my-2 h-px bg-line" />
  ) : (
    <h2 className="px-3 pt-4 pb-1 text-label text-ink-2">{children}</h2>
  );
}

function Sidebar({ me, collapsed, onToggle }: { me: MeResponse; collapsed: boolean; onToggle?: () => void }) {
  const projects = useMyProjects();
  const admin = adminLinks(me);
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-card md:flex",
        "transition-[width] duration-(--duration-sheet) ease-out",
        collapsed ? "w-rail" : "w-sidebar",
      )}
    >
      <div className={cn("flex items-center gap-2 border-b border-line p-4", collapsed ? "flex-col" : "justify-between")}>
        <Link to="/work" className="rounded-control">
          <BrandMark showName={!collapsed} />
        </Link>
        {onToggle && (
          <IconButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={onToggle}
          />
        )}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-1">
          <SidebarLink to="/work" label="My Work" icon={House} collapsed={collapsed} />
        </ul>

        <SectionLabel collapsed={collapsed}>Projects</SectionLabel>
        <ul className="flex flex-col gap-1" aria-label={collapsed ? "Projects" : undefined}>
          {projects.isPending &&
            [0, 1].map((i) => (
              <li key={i} className="px-3 py-3">
                <Skeleton className="h-5 w-full" />
              </li>
            ))}
          {projects.data?.map((p) => (
            <SidebarLink
              key={p.id}
              to={`/projects/${p.key}`}
              label={p.name}
              collapsed={collapsed}
              leading={<ProjectGlyph project={p} />}
            />
          ))}
          <SidebarLink to="/projects" end label="All projects" icon={FolderKanban} collapsed={collapsed} />
        </ul>

        {admin.length > 0 && (
          <>
            <SectionLabel collapsed={collapsed}>Admin</SectionLabel>
            <ul className="flex flex-col gap-1">
              {admin.map((item) => (
                <SidebarLink key={item.to} {...item} collapsed={collapsed} />
              ))}
            </ul>
          </>
        )}
      </nav>

      <div className="border-t border-line p-3">
        <ProfilePopover me={me} collapsed={collapsed} />
      </div>
    </aside>
  );
}

function ProfilePopover({ me, collapsed }: { me: MeResponse; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label={collapsed ? `Account: ${me.user.name}` : undefined}
        className={cn(
          "flex min-h-touch w-full items-center gap-3 rounded-control text-left state-hover:bg-hover",
          collapsed ? "justify-center" : "px-2 py-2",
        )}
      >
        <Avatar name={me.user.name} url={me.user.avatarUrl} size="sm" />
        {!collapsed && (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-secondary font-medium text-ink">{me.user.name}</span>
            <span className="truncate text-caption text-ink-2">Account and theme</span>
          </span>
        )}
      </button>
    </PopoverTrigger>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {collapsed ? <Tooltip content="Account" side="right">{trigger}</Tooltip> : trigger}
      <PopoverContent side="right" align="end" aria-label="Account" className="w-80">
        <ProfilePanel me={me} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** Name, theme, request more projects (AUTH-5), privacy and sign out. Used in the popover and the mobile sheet. */
function ProfilePanel({ me, onDone }: { me: MeResponse; onDone: () => void }) {
  const saveTheme = useSaveTheme(me);
  const signOut = useSignOut();
  const navigate = useNavigate();
  const linkClass =
    "flex min-h-touch items-center gap-3 rounded-control px-3 text-secondary text-ink state-hover:bg-hover";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar name={me.user.name} url={me.user.avatarUrl} />
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-ink">{me.user.name}</p>
          <p className="truncate text-secondary text-ink-2">{me.user.email}</p>
        </div>
      </div>
      <ThemeSwitch onPreferenceChange={(pref) => void saveTheme(pref)} />
      <nav aria-label="Account" className="-mx-1 flex flex-col">
        <Link to="/request-access" className={linkClass} onClick={onDone}>
          <Icon icon={FolderPlus} />
          Request access to more projects
        </Link>
        <Link to="/privacy" className={linkClass} onClick={onDone}>
          <Icon icon={Shield} />
          Privacy policy
        </Link>
      </nav>
      <Button
        variant="secondary"
        icon={LogOut}
        onClick={async () => {
          onDone();
          await signOut(me.csrfToken);
          navigate("/", { replace: true });
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

/* ---------- Bottom navigation (mobile) ---------- */

const tabClasses = (active: boolean) =>
  cn(
    "flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 rounded-control text-label",
    active ? "text-accent-ink" : "text-ink-2 state-hover:text-ink",
  );

function BottomNav({ me }: { me: MeResponse }) {
  const [meOpen, setMeOpen] = useState(false);
  const admin = adminLinks(me);
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex h-bottom-nav items-stretch gap-1 px-2 py-2">
        <li className="flex flex-1">
          <NavLink to="/work" className={({ isActive }) => tabClasses(isActive)}>
            <Icon icon={House} />
            My Work
          </NavLink>
        </li>
        <li className="flex flex-1">
          <NavLink to="/projects" className={({ isActive }) => tabClasses(isActive)}>
            <Icon icon={FolderKanban} />
            Projects
          </NavLink>
        </li>
        {admin.length > 0 && (
          <li className="flex flex-1">
            {/* Any admin page counts as this tab, whichever one it opens. */}
            <Link
              to={admin[0]!.to}
              className={tabClasses(pathname.startsWith("/admin"))}
              aria-current={pathname.startsWith("/admin") ? "page" : undefined}
            >
              <Icon icon={Settings2} />
              Admin
            </Link>
          </li>
        )}
        <li className="flex flex-1">
          <Dialog open={meOpen} onOpenChange={setMeOpen}>
            <button type="button" className={tabClasses(meOpen)} onClick={() => setMeOpen(true)} aria-haspopup="dialog">
              <Icon icon={CircleUser} />
              Me
            </button>
            <SheetContent title="Your account">
              <ProfilePanel me={me} onDone={() => setMeOpen(false)} />
            </SheetContent>
          </Dialog>
        </li>
      </ul>
    </nav>
  );
}
