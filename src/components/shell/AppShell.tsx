import {
  ArrowLeft,
  ChartColumn,
  ChevronDown,
  CircleUser,
  Database,
  FolderKanban,
  FolderPlus,
  Gauge,
  House,
  Inbox,
  LayoutGrid,
  type LucideIcon,
  LogOut,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ScrollText,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  Users,
  UserX,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate, useOutletContext, useResolvedPath } from "react-router";
import type { MeResponse } from "../../../shared/auth";
import type { ProjectSummary } from "../../../shared/projects";
import { cn } from "../../lib/cn";
import { TABLET_QUERY, useMediaQuery } from "../../lib/media";
import { useSaveTheme } from "../../lib/profile";
import { PROJECT_COLOUR_CLASSES, PROJECT_ICON_COMPONENTS, useMyProjects } from "../../lib/projects";
import { useSignOut } from "../../lib/session";
import { CommandPalette, openCommandPalette } from "../CommandPalette";
import { HelpMenu } from "../HelpMenu";
import { NotificationBell } from "../NotificationBell";
import { ErrorBoundary } from "../ErrorBoundary";
import { SessionGate } from "../SessionGate";
import { InstallPrompt, OfflineBanner } from "../StatusBanners";
import { Avatar } from "../ui/Avatar";
import { Button, IconButton } from "../ui/Button";
import { Dialog, SheetContent } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "../ui/Menu";
import { Skeleton } from "../ui/Skeleton";
import { ThemeSwitch } from "../ui/ThemeSwitch";
import { Tooltip } from "../ui/Tooltip";
import { BrandMark } from "./BrandMark";

// The app shell (section 12), laid out like a work tracker:
// - a top bar across the screen: logo, "Jump to…" search, Create, Help, notifications and the account menu;
// - a sidebar on desktop (an icon rail on tablet) with the person's work and projects, and one
//   "Administration" entry. Inside /admin the sidebar becomes the admin area's own navigation, so admin
//   tools never crowd everyday navigation;
// - a bottom navigation bar on mobile.
// Only Active members get it; Pending people and the security screens (section 11.7) render without it.

/** The signed-in person, for pages inside the shell. */
export function useMe(): MeResponse {
  return useOutletContext<MeResponse>();
}

export function AppShell() {
  return <SessionGate allow={(me) => me.user.status === "active"}>{(me) => <Shell me={me} />}</SessionGate>;
}

const RAIL_STORAGE_KEY = "cph-sidebar-expanded";
/** Projects listed in the sidebar before "All projects" takes over. */
const SIDEBAR_PROJECT_LIMIT = 6;

function readExpanded(): boolean {
  try {
    return localStorage.getItem(RAIL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export type AdminGroup = "People" | "Projects" | "System";

export type AdminLink = { to: string; label: string; icon: LucideIcon; group: AdminGroup; description: string };

/** What the admin area holds for this person. Hiding these links is convenience; the API checks (NFR-1). */
export function adminLinks(me: MeResponse): AdminLink[] {
  const appAdmin = me.user.appRole === "admin";
  const links: (AdminLink | false)[] = [
    me.canReviewAccess && {
      to: "/admin/requests",
      label: "Access requests",
      icon: Inbox,
      group: "People",
      description: "Approve or deny people asking to join, and send invites.",
    },
    appAdmin && {
      to: "/admin/users",
      label: "Users",
      icon: Users,
      group: "People",
      description: "Find anyone, change their projects, suspend or restore them.",
    },
    appAdmin && {
      to: "/admin/projects",
      label: "Manage projects",
      icon: Settings2,
      group: "Projects",
      description: "Create projects, edit their name, colour and icon, or archive them.",
    },
    appAdmin && {
      to: "/admin/reports",
      label: "Church reports",
      icon: ChartColumn,
      group: "Projects",
      description: "See how every team is doing, side by side.",
    },
    appAdmin && {
      to: "/admin/audit",
      label: "Audit log",
      icon: ScrollText,
      group: "System",
      description: "Who changed what, and when. Search it or download it.",
    },
    appAdmin && {
      to: "/admin/usage",
      label: "Usage",
      icon: Gauge,
      group: "System",
      description: "How much of the free plan the hub has used today and this month.",
    },
    appAdmin && {
      to: "/admin/deletions",
      label: "Data deletion",
      icon: UserX,
      group: "System",
      description: "Deletion requests and old data that's ready to be removed.",
    },
  ];
  return links.filter((l): l is AdminLink => !!l);
}

export const ADMIN_GROUPS: AdminGroup[] = ["People", "Projects", "System"];

/** Breadcrumb for every page inside the admin area. */
export const ADMIN_CRUMBS = [{ to: "/admin", label: "Administration" }];

/** The shell around one page that isn't a nested route (e.g. /request-access for active members). */
export function ShellFrame({ me, children }: { me: MeResponse; children: ReactNode }) {
  return <Shell me={me}>{children}</Shell>;
}

function Shell({ me, children }: { me: MeResponse; children?: ReactNode }) {
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
    <div className="min-h-dvh bg-page">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-elevated px-4 py-3 text-ink shadow-floating focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to content
      </a>
      <TopBar me={me} />
      <div className="md:flex">
        <Sidebar me={me} collapsed={collapsed} onToggle={isTablet ? toggleRail : undefined} />
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="min-w-0 flex-1 pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] outline-none md:pb-0"
        >
          <OfflineBanner />
          {/* Section 11.13: a crashed page stays inside the shell; navigation keeps working. Keyed so it resets. */}
          <ErrorBoundary key={pathname} section={pathname.split("/")[1] || "home"}>
            {children ?? <Outlet context={me} />}
          </ErrorBoundary>
        </main>
      </div>
      <BottomNav me={me} />
      <CommandPalette me={me} />
      <InstallPrompt me={me} />
    </div>
  );
}

/* ---------- Top bar (every size) ---------- */

function TopBar({ me }: { me: MeResponse }) {
  return (
    <header className="sticky top-0 z-30 flex h-topbar items-center gap-3 border-b border-line bg-card px-3 md:px-4">
      <Link to="/work" className="shrink-0 rounded-control">
        <BrandMark />
      </Link>
      <div className="hidden min-w-0 flex-1 justify-center px-4 md:flex">
        <JumpToButton />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <CreateButton me={me} />
        <HelpMenu />
        <NotificationBell me={me} />
        <ProfilePopover me={me} />
      </div>
    </header>
  );
}

/** Opens the command palette (NAV-2); the shortcut is shown so people learn it. */
function JumpToButton() {
  const mac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
  const shortcut = mac ? "⌘K" : "Ctrl K";
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      className="lift flex min-h-touch w-full max-w-xl items-center gap-3 rounded-control border border-line-strong bg-page px-3 text-secondary text-ink-2 state-hover:border-accent state-hover:text-ink"
    >
      <Icon icon={Search} />
      <span className="flex-1 truncate text-left">Jump to a task, project or page…</span>
      <kbd className="rounded-chip border border-line bg-card px-1.5 text-label">{shortcut}</kbd>
    </button>
  );
}

/** Projects where this person may add tasks (section 2). The API checks again. */
function creatableProjects(me: MeResponse, projects: ProjectSummary[]): ProjectSummary[] {
  return projects.filter((p) => !p.archived && (me.user.appRole === "admin" || p.role === "admin" || p.role === "contributor"));
}

/** "Create": a new task in any project the person can add to. It opens that project's New task form. */
function CreateButton({ me }: { me: MeResponse }) {
  const projects = useMyProjects();
  const navigate = useNavigate();
  const targets = creatableProjects(me, projects.data ?? []);
  if (targets.length === 0) return null;
  // Desktop and tablet only: on phones the board's own New task button is in reach.
  return (
    <Menu>
      <span className="mr-2 hidden md:block">
        <MenuTrigger asChild>
          <Button icon={Plus}>
            Create
            <Icon icon={ChevronDown} size="sm" />
          </Button>
        </MenuTrigger>
      </span>
      <MenuContent className="max-h-96 overflow-y-auto">
        <MenuLabel>New task in…</MenuLabel>
        {targets.map((p) => (
          <MenuItem key={p.id} onSelect={() => navigate(`/projects/${p.key}?new=1`)}>
            <ProjectTile project={p} size="sm" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/* ---------- Project marks ---------- */

/** A project's icon in its colour, for rows and lists. */
export function ProjectGlyph({ project, size = "md" }: { project: Pick<ProjectSummary, "colour" | "icon">; size?: "md" | "sm" }) {
  return <Icon icon={PROJECT_ICON_COMPONENTS[project.icon]} size={size} className={PROJECT_COLOUR_CLASSES[project.colour].text} />;
}

const TILE_SIZES = { sm: "size-6 rounded-chip", md: "size-10 rounded-control", lg: "size-12 rounded-card" } as const;

/** A project's identity tile: its icon on a square of its colour (sidebar, headers, project cards). */
export function ProjectTile({ project, size = "md" }: { project: Pick<ProjectSummary, "colour" | "icon">; size?: keyof typeof TILE_SIZES }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center text-on-accent", TILE_SIZES[size], PROJECT_COLOUR_CLASSES[project.colour].bg)}
    >
      <Icon icon={PROJECT_ICON_COMPONENTS[project.icon]} size={size === "sm" ? "sm" : "md"} />
    </span>
  );
}

/* ---------- Sidebar (tablet and desktop) ---------- */

const navItemClasses = (active: boolean, collapsed: boolean) =>
  cn(
    "relative flex min-h-touch items-center gap-3 rounded-control text-secondary transition-colors duration-(--duration-micro) ease-out",
    collapsed ? "justify-center px-0" : "px-3",
    active
      ? "bg-accent-soft font-semibold text-accent-ink before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-accent before:content-['']"
      : "text-ink state-hover:bg-hover",
  );

function SidebarLink({
  to,
  label,
  icon,
  collapsed,
  end,
  leading,
  trailing,
}: {
  to: string;
  label: string;
  icon?: LucideIcon;
  collapsed: boolean;
  end?: boolean;
  /** Replaces the icon (e.g. a project's tile). */
  leading?: ReactNode;
  /** Shown after the label when expanded; decorative. */
  trailing?: ReactNode;
}) {
  // The active state is worked out here and passed as a plain string: in the collapsed rail the tooltip's Slot
  // merges props, and it would turn NavLink's className function into text.
  const isActive = useMatch({ path: useResolvedPath(to).pathname, end: !!end }) !== null;
  const link = (
    <NavLink to={to} end={end} aria-label={collapsed ? label : undefined} className={navItemClasses(isActive, collapsed)}>
      {leading ?? (icon && <Icon icon={icon} />)}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && trailing}
    </NavLink>
  );
  return <li>{collapsed ? <Tooltip content={label} side="right">{link}</Tooltip> : link}</li>;
}

function SectionLabel({ collapsed, children }: { collapsed: boolean; children: string }) {
  return collapsed ? (
    <div role="separator" className="mx-3 my-3 h-px bg-line" />
  ) : (
    <h2 className="px-3 pt-5 pb-1.5 text-label font-semibold tracking-wide text-ink-2 uppercase">{children}</h2>
  );
}

function Sidebar({ me, collapsed, onToggle }: { me: MeResponse; collapsed: boolean; onToggle?: () => void }) {
  const { pathname } = useLocation();
  const inAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  return (
    <aside
      className={cn(
        "sticky top-topbar hidden h-[calc(100dvh-var(--spacing-topbar))] shrink-0 flex-col border-r border-line bg-card md:flex",
        "transition-[width] duration-(--duration-sheet) ease-out",
        collapsed ? "w-rail" : "w-sidebar",
      )}
    >
      {inAdmin ? <AdminNav me={me} collapsed={collapsed} /> : <MainNav me={me} collapsed={collapsed} />}
      {onToggle && (
        <div className={cn("border-t border-line p-3", collapsed && "flex justify-center")}>
          <IconButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={onToggle}
          />
        </div>
      )}
    </aside>
  );
}

function MainNav({ me, collapsed }: { me: MeResponse; collapsed: boolean }) {
  const projects = useMyProjects();
  const { pathname } = useLocation();
  const hasAdmin = adminLinks(me).length > 0;
  const all = projects.data ?? [];
  // Keep the list short; the open project always stays visible.
  const currentKey = pathname.match(/^\/projects\/([^/]+)/)?.[1]?.toUpperCase();
  let shown = all.slice(0, SIDEBAR_PROJECT_LIMIT);
  const current = all.find((p) => p.key === currentKey);
  if (current && !shown.includes(current)) shown = [...shown.slice(0, SIDEBAR_PROJECT_LIMIT - 1), current];
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col overflow-y-auto p-3">
      <SectionLabel collapsed={collapsed}>For you</SectionLabel>
      <ul className="flex flex-col gap-1">
        <SidebarLink to="/work" label="My Work" icon={House} collapsed={collapsed} />
        <SidebarLink to="/search" label="Search" icon={Search} collapsed={collapsed} />
      </ul>

      <SectionLabel collapsed={collapsed}>Projects</SectionLabel>
      <ul className="flex flex-col gap-1" aria-label={collapsed ? "Projects" : undefined}>
        {projects.isPending &&
          [0, 1].map((i) => (
            <li key={i} className="px-3 py-3">
              <Skeleton className="h-5 w-full" />
            </li>
          ))}
        {shown.map((p) => (
          <SidebarLink key={p.id} to={`/projects/${p.key}`} label={p.name} collapsed={collapsed} leading={<ProjectTile project={p} size="sm" />} />
        ))}
        <SidebarLink
          to="/projects"
          end
          label="All projects"
          icon={LayoutGrid}
          collapsed={collapsed}
          trailing={
            all.length > shown.length && (
              <span aria-hidden="true" className="rounded-chip bg-hover px-1.5 text-label text-ink-2 tabular-nums">
                {all.length}
              </span>
            )
          }
        />
      </ul>

      {hasAdmin && (
        <div className="mt-auto pt-4">
          <ul className="flex flex-col gap-1 border-t border-line pt-3">
            <SidebarLink to="/admin" label="Administration" icon={ShieldCheck} collapsed={collapsed} />
          </ul>
        </div>
      )}
    </nav>
  );
}

/** Inside /admin: the admin area's own navigation, grouped, with a clear way back. */
function AdminNav({ me, collapsed }: { me: MeResponse; collapsed: boolean }) {
  const links = adminLinks(me);
  const back = (
    <Link
      to="/work"
      aria-label={collapsed ? "Back to My Work" : undefined}
      className={cn(
        "flex min-h-touch items-center gap-3 rounded-control text-secondary text-ink-2 state-hover:bg-hover state-hover:text-ink",
        collapsed ? "justify-center" : "px-3",
      )}
    >
      <Icon icon={ArrowLeft} />
      {!collapsed && "Back to My Work"}
    </Link>
  );
  return (
    <nav aria-label="Admin" className="flex flex-1 flex-col overflow-y-auto p-3">
      {collapsed ? <Tooltip content="Back to My Work" side="right">{back}</Tooltip> : back}
      {!collapsed && (
        <p className="flex items-center gap-2 px-3 pt-4 text-body font-semibold text-ink">
          <Icon icon={ShieldCheck} className="text-accent-ink" />
          Administration
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-1">
        <SidebarLink to="/admin" end label="Overview" icon={LayoutGrid} collapsed={collapsed} />
      </ul>
      {ADMIN_GROUPS.map((group) => {
        const items = links.filter((l) => l.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <SectionLabel collapsed={collapsed}>{group}</SectionLabel>
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <SidebarLink key={item.to} to={item.to} label={item.label} icon={item.icon} collapsed={collapsed} />
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/* ---------- Account ---------- */

function ProfilePopover({ me }: { me: MeResponse }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Your account">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Account: ${me.user.name}`}
            className="ml-1 hidden size-touch items-center justify-center rounded-full state-hover:bg-hover md:inline-flex"
          >
            <Avatar name={me.user.name} url={me.user.avatarUrl} size="sm" className="ring-2 ring-accent-soft" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="bottom" align="end" aria-label="Account" className="w-80">
        <ProfilePanel me={me} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** Name, theme, request more projects (AUTH-5), email settings (NOTIF-5), privacy and sign out. Used in the popover and the mobile sheet. */
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
        <Link to="/settings/notifications" className={linkClass} onClick={onDone}>
          <Icon icon={Mail} />
          Email settings
        </Link>
        <Link to="/settings/data" className={linkClass} onClick={onDone}>
          <Icon icon={Database} />
          Your data
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
    "flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 rounded-control text-label transition-colors duration-(--duration-micro) ease-out",
    active ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink-2 state-hover:text-ink",
  );

function BottomNav({ me }: { me: MeResponse }) {
  const [meOpen, setMeOpen] = useState(false);
  const hasAdmin = adminLinks(me).length > 0;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex h-bottom-nav items-stretch gap-1 px-2 py-1.5">
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
        <li className="flex flex-1">
          <NavLink to="/search" className={({ isActive }) => tabClasses(isActive)}>
            <Icon icon={Search} />
            Search
          </NavLink>
        </li>
        {hasAdmin && (
          <li className="flex flex-1">
            <NavLink to="/admin" className={({ isActive }) => tabClasses(isActive)}>
              <Icon icon={ShieldCheck} />
              Admin
            </NavLink>
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
