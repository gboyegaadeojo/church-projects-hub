import { Archive, Copy, Ellipsis, Inbox, Pencil, Plus, Trash2, UserX } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Badge, Chip, type BadgeTone } from "../../components/ui/Badge";
import { Button, IconButton, type ButtonVariant } from "../../components/ui/Button";
import { Checkbox, RadioGroup, Select, Switch } from "../../components/ui/choices";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dialog, DialogClose, DialogContent, DialogTrigger, SheetContent } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { DateInput, Textarea, TextInput } from "../../components/ui/inputs";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "../../components/ui/Menu";
import { ThemeScope } from "../../components/ui/portal";
import { LoadingRegion, Skeleton } from "../../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../../components/ui/States";
import { Table, type Column, type SortState } from "../../components/ui/Table";
import { ThemeSwitch } from "../../components/ui/ThemeSwitch";
import { toast, ToastPreview } from "../../components/ui/Toast";

// Development-only gallery (Stage 1): every component in every state, light and dark side by side.
// Hover, pressed and focus are shown statically with data-preview; overlays open in their column's theme.

type Theme = "light" | "dark";

export default function DevComponentsPage() {
  return (
    <main className="min-h-screen">
      <header className="flex flex-col gap-4 border-b border-line bg-card px-4 py-6 md:flex-row md:items-end md:justify-between md:px-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-large-title">Components</h1>
          <p className="text-secondary text-ink-2">
            Design foundation (Stage 1). Left column is the light theme, right column is dark. Development only.
          </p>
        </div>
        <ThemeSwitch />
      </header>
      <div className="grid xl:grid-cols-2">
        <ThemeScope theme="light" className="min-w-0">
          <Gallery theme="light" />
        </ThemeScope>
        <ThemeScope theme="dark" className="min-w-0">
          <Gallery theme="dark" />
        </ThemeScope>
      </div>
    </main>
  );
}

function Gallery({ theme }: { theme: Theme }) {
  const headingId = useId();
  const name = theme === "light" ? "Light theme" : "Dark theme";
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-10 px-4 py-8 md:px-8">
      <h2 id={headingId} className="text-title">
        {name}
      </h2>
      <TypographySection />
      <ButtonsSection />
      <FormSection />
      <BadgesSection />
      <OverlaysSection />
      <ToastsSection />
      <LoadingSection />
      <StatesSection />
      <TableSection theme={theme} />
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-label tracking-wide text-ink-2 uppercase">{title}</h3>
      <div className="flex flex-col gap-6 rounded-card bg-card p-component shadow-raised">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-ink-2">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* ---------- Typography ---------- */

function TypographySection() {
  return (
    <Section title="Typography">
      <p className="text-large-title">Large title 34</p>
      <p className="text-title">Title 22</p>
      <p className="text-body">Body 17 — the default reading size.</p>
      <p className="text-secondary text-ink-2">Secondary 15 — supporting text.</p>
      <p className="text-caption text-ink-2 tabular-nums">Caption 13 — due 14 Oct 2026 · 3 comments</p>
      <p className="text-label">Label 12</p>
      <p className="text-body">
        Link style:{" "}
        <a href="#top" className="text-accent-ink underline underline-offset-4">
          View all tasks
        </a>
      </p>
    </Section>
  );
}

/* ---------- Buttons ---------- */

const buttonVariants: Array<{ variant: ButtonVariant; label: string; icon?: typeof Plus }> = [
  { variant: "primary", label: "Create task", icon: Plus },
  { variant: "secondary", label: "Edit", icon: Pencil },
  { variant: "ghost", label: "Copy link", icon: Copy },
  { variant: "destructive", label: "Delete task", icon: Trash2 },
];

const previewStates = ["default", "hover", "pressed", "focus"] as const;

function ButtonsSection() {
  return (
    <Section title="Buttons">
      {buttonVariants.map(({ variant, label, icon }) => (
        <Row key={variant} label={variant}>
          {previewStates.map((state) => (
            <Button key={state} variant={variant} icon={icon} data-preview={state === "default" ? undefined : state}>
              {state === "default" ? label : state[0]!.toUpperCase() + state.slice(1)}
            </Button>
          ))}
          <Button variant={variant} icon={icon} disabled>
            Disabled
          </Button>
          <Button variant={variant} loading>
            Saving
          </Button>
        </Row>
      ))}
      <Row label="icon-only (ghost, secondary, destructive; hover, focus, disabled, loading)">
        <IconButton icon={Ellipsis} label="More actions" />
        <IconButton icon={Pencil} label="Edit task" variant="secondary" />
        <IconButton icon={Trash2} label="Delete task" variant="destructive" />
        <IconButton icon={Pencil} label="Edit task (hover)" variant="secondary" data-preview="hover" />
        <IconButton icon={Pencil} label="Edit task (focus)" variant="secondary" data-preview="focus" />
        <IconButton icon={Pencil} label="Edit task (disabled)" variant="secondary" disabled />
        <IconButton icon={Pencil} label="Saving" variant="secondary" loading />
      </Row>
    </Section>
  );
}

/* ---------- Forms ---------- */

const statusOptions = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked", disabled: true },
];

function FormSection() {
  const [title, setTitle] = useState("");
  return (
    <Section title="Form controls">
      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Task title" required hint="Keep it short; details go in the description.">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Update lower thirds" />
        </Field>
        <Field label="Task title" required error="Enter a title for the task.">
          <TextInput defaultValue="" />
        </Field>
        <Field label="Location">
          <TextInput defaultValue="Main sanctuary" data-preview="focus" />
        </Field>
        <Field label="Project key" hint="Set when the project is created.">
          <TextInput defaultValue="MEDIA" disabled />
        </Field>
        <Field label="Description" hint="Don't include children's details or confidential pastoral information.">
          <Textarea placeholder="What needs to happen?" />
        </Field>
        <Field label="Description" required error="Description must be 5,000 characters or fewer. Shorten it and try again.">
          <Textarea defaultValue="A very long description…" />
        </Field>
        <Field label="Status" required>
          <Select options={statusOptions} defaultValue="doing" />
        </Field>
        <Field label="Status" required error="Choose a status.">
          <Select options={statusOptions} />
        </Field>
        <Field label="Status">
          <Select options={statusOptions} defaultValue="todo" disabled />
        </Field>
        <Field label="Due date" hint="Leave empty if there is no deadline.">
          <DateInput defaultValue="2026-10-18" />
        </Field>
        <Field label="Due date" error="Pick a date today or later.">
          <DateInput defaultValue="2026-01-04" />
        </Field>
        <Field label="Due date">
          <DateInput disabled />
        </Field>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col">
          <Checkbox label="Notify watchers" />
          <Checkbox label="Notify watchers" defaultChecked />
          <Checkbox label="Notify watchers" disabled />
          <Checkbox label="Notify watchers" defaultChecked disabled />
          <Checkbox label="I understand this can't be undone" error="Tick this box to continue." />
        </div>
        <div className="flex flex-col">
          <Switch label="Email digest" hint="A summary at 7 am each day." />
          <Switch label="Email digest" defaultChecked />
          <Switch label="Email digest" disabled />
          <Switch label="Email digest" defaultChecked disabled />
        </div>
        <RadioGroup legend="Priority" options={priorityOptions} defaultValue="normal" />
        <RadioGroup legend="Priority" options={priorityOptions} error="Choose a priority." />
        <RadioGroup legend="Priority" options={priorityOptions} defaultValue="low" disabled />
      </div>
    </Section>
  );
}

const priorityOptions = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

/* ---------- Badges and chips ---------- */

const badgeTones: Array<{ tone: BadgeTone; label: string }> = [
  { tone: "neutral", label: "Backlog" },
  { tone: "accent", label: "Media" },
  { tone: "overdue", label: "Overdue" },
  { tone: "due-soon", label: "Due soon" },
  { tone: "done", label: "Done" },
  { tone: "success", label: "Approved" },
  { tone: "warning", label: "Pending" },
  { tone: "error", label: "Failed" },
  { tone: "info", label: "New" },
];

function BadgesSection() {
  const [selected, setSelected] = useState(true);
  const [removed, setRemoved] = useState(false);
  return (
    <Section title="Badges and chips">
      <Row label="badges">
        {badgeTones.map(({ tone, label }) => (
          <Badge key={tone} tone={tone}>
            {label}
          </Badge>
        ))}
      </Row>
      <Row label="chips (toggle, selected, disabled, removable)">
        <Chip label="Assigned to me" />
        <Chip label="Due this week" selected={selected} onClick={() => setSelected(!selected)} />
        <Chip label="Has attachments" disabled />
        {!removed && <Chip label="Label: Sunday" onRemove={() => setRemoved(true)} />}
        {removed && (
          <Button variant="ghost" onClick={() => setRemoved(false)}>
            Restore chip
          </Button>
        )}
      </Row>
    </Section>
  );
}

/* ---------- Dialogs, sheets, menus ---------- */

function OverlaysSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedOpen, setTypedOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  return (
    <Section title="Dialogs, sheets, menus and popovers">
      <Row label="dialog and sheet">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open dialog</Button>
          </DialogTrigger>
          <DialogContent
            title="Rename project"
            description="The new name shows for everyone on the project."
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>Save name</Button>
                </DialogClose>
              </>
            }
          >
            <Field label="Project name" required>
              <TextInput defaultValue="Media team" />
            </Field>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open sheet</Button>
          </DialogTrigger>
          <SheetContent
            title="MEDIA-42 · Update lower thirds"
            description="Sheet from the right on tablet and desktop, from the bottom on mobile."
            footer={
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            }
          >
            <div className="flex flex-col gap-4">
              <Field label="Title" required>
                <TextInput defaultValue="Update lower thirds" />
              </Field>
              <Field label="Description">
                <Textarea defaultValue="New template for the sermon series." />
              </Field>
            </div>
          </SheetContent>
        </Dialog>
      </Row>
      <Row label="confirmation dialog (section 11.14)">
        <Button variant="destructive" icon={Trash2} onClick={() => setConfirmOpen(true)}>
          Delete task…
        </Button>
        <Button variant="destructive" icon={Archive} onClick={() => setTypedOpen(true)}>
          Archive project…
        </Button>
        <Button variant="secondary" icon={UserX} onClick={() => setFailOpen(true)}>
          Suspend user (fails)…
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete MEDIA-42?"
          description="This removes the task and its comments for everyone."
          confirmLabel="Delete task"
          confirmIcon={Trash2}
          onConfirm={() => wait(800)}
          successMessage="Task deleted."
        />
        <ConfirmDialog
          open={typedOpen}
          onOpenChange={setTypedOpen}
          title="Archive the Media project?"
          description="Members lose access to its board until an admin restores it."
          confirmLabel="Archive project"
          confirmIcon={Archive}
          confirmText="MEDIA"
          onConfirm={() => wait(800)}
          successMessage="Project archived."
        />
        <ConfirmDialog
          open={failOpen}
          onOpenChange={setFailOpen}
          title="Suspend this user?"
          description="They are signed out everywhere and can't sign back in until restored."
          confirmLabel="Suspend user"
          confirmIcon={UserX}
          onConfirm={() => wait(800).then(() => Promise.reject(new Error("demo failure")))}
        />
      </Row>
      <Row label="menu and popover">
        <Menu>
          <MenuTrigger asChild>
            <IconButton icon={Ellipsis} label="Task actions" variant="secondary" />
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>MEDIA-42</MenuLabel>
            <MenuItem icon={Pencil}>Edit</MenuItem>
            <MenuItem icon={Copy}>Copy link</MenuItem>
            <MenuItem icon={Archive} disabled>
              Move to project
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Trash2} destructive onSelect={() => setConfirmOpen(true)}>
              Delete task…
            </MenuItem>
          </MenuContent>
        </Menu>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">Open popover</Button>
          </PopoverTrigger>
          <PopoverContent>
            <div className="flex flex-col gap-2">
              <p className="text-secondary font-medium">Due date rules</p>
              <p className="text-caption text-ink-2">Overdue dates show in red with an icon; due within 2 days shows in amber.</p>
            </div>
          </PopoverContent>
        </Popover>
      </Row>
    </Section>
  );
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/* ---------- Toasts ---------- */

function ToastsSection() {
  return (
    <Section title="Toasts">
      <div className="flex max-w-sm flex-col gap-2">
        <ToastPreview variant="success" title="Task deleted." />
        <ToastPreview variant="info" title="Saved." />
        <ToastPreview variant="warning" title="This is taking longer than expected." description="Check your connection." />
        <ToastPreview variant="error" title="We couldn't save this change." description="Check your connection and try again." />
      </div>
      <Row label="live (auto-dismiss after 5 s, pauses on hover; shown in the page theme)">
        <Button variant="secondary" onClick={() => toast({ variant: "success", title: "Saved." })}>
          Success toast
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast({ variant: "warning", title: "This is taking longer than expected. Check your connection." })}
        >
          Warning toast
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({ variant: "error", title: "We couldn't save this change.", description: "Check your connection and try again." })
          }
        >
          Error toast
        </Button>
      </Row>
    </Section>
  );
}

/* ---------- Loading ---------- */

function TaskCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line p-4">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-4 w-3/4" />
      <div className="flex items-center gap-2">
        <Skeleton className="size-6 rounded-full" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

function LoadingSection() {
  const [loading, setLoading] = useState(false);
  function simulate(ms: number) {
    setLoading(true);
    setTimeout(() => setLoading(false), ms);
  }
  return (
    <Section title="Skeletons">
      <Row label="shape of a task card (shimmer is off with reduced motion)">
        <div className="grid w-full gap-3 sm:grid-cols-2">
          <TaskCardSkeleton />
          <TaskCardSkeleton />
        </div>
      </Row>
      <Row label="loading region: nothing under 200 ms, then skeleton, then content">
        <Button variant="secondary" onClick={() => simulate(150)}>
          Fast load (150 ms)
        </Button>
        <Button variant="secondary" onClick={() => simulate(2000)}>
          Slow load (2 s)
        </Button>
      </Row>
      <LoadingRegion loading={loading} label="Loading tasks" skeleton={<TaskCardSkeleton />}>
        <div className="rounded-card border border-line p-4">
          <p className="text-caption text-ink-2 tabular-nums">MEDIA-42</p>
          <p className="text-body">Update lower thirds</p>
        </div>
      </LoadingRegion>
    </Section>
  );
}

/* ---------- Empty and error states ---------- */

function StatesSection() {
  const [retrying, setRetrying] = useState(false);
  return (
    <Section title="Empty and error states">
      <EmptyState icon={Inbox} title="No tasks yet. Create the first one." action={<Button icon={Plus}>Create task</Button>} />
      <ErrorState
        title="Something went wrong loading this section."
        description="Try refreshing the page."
        retrying={retrying}
        onRetry={() => {
          setRetrying(true);
          setTimeout(() => setRetrying(false), 1200);
        }}
      />
    </Section>
  );
}

/* ---------- Table ---------- */

type DemoTask = { key: string; title: string; status: BadgeTone; statusLabel: string; due: string };

const demoTasks: DemoTask[] = [
  { key: "MEDIA-38", title: "Replace HDMI cable at stage left", status: "overdue", statusLabel: "Overdue", due: "2026-10-09" },
  { key: "MEDIA-39", title: "Update lower thirds template", status: "due-soon", statusLabel: "Due soon", due: "2026-10-15" },
  { key: "MEDIA-40", title: "Test new livestream encoder", status: "neutral", statusLabel: "To do", due: "2026-10-22" },
  { key: "MEDIA-41", title: "Rota for November services", status: "done", statusLabel: "Done", due: "2026-10-12" },
  { key: "MEDIA-42", title: "Archive September recordings", status: "neutral", statusLabel: "To do", due: "2026-10-29" },
  { key: "MEDIA-43", title: "Order spare batteries for mics", status: "due-soon", statusLabel: "Due soon", due: "2026-10-16" },
  { key: "MEDIA-44", title: "Clean projector filters", status: "neutral", statusLabel: "To do", due: "2026-11-02" },
];

const taskColumns: Column<DemoTask>[] = [
  { key: "key", header: "Key", sortable: true, cell: (t) => <span className="tabular-nums">{t.key}</span> },
  { key: "title", header: "Title", sortable: true, cell: (t) => t.title },
  { key: "status", header: "Status", cell: (t) => <Badge tone={t.status}>{t.statusLabel}</Badge> },
  { key: "due", header: "Due", sortable: true, numeric: true, cell: (t) => t.due },
];

const PAGE_SIZE = 5;

function TableSection({ theme }: { theme: Theme }) {
  const [sort, setSort] = useState<SortState>({ key: "key", direction: "ascending" });
  const [page, setPage] = useState(1);
  const sorted = [...demoTasks].sort((a, b) => {
    const field = sort.key as keyof DemoTask;
    const order = a[field].localeCompare(b[field]);
    return sort.direction === "ascending" ? order : -order;
  });
  const rows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <Section title="Table">
      <Table
        caption={`Media tasks (${theme})`}
        columns={taskColumns}
        rows={rows}
        getRowKey={(t) => t.key}
        sort={sort}
        onSortChange={setSort}
        rowActions={(t) => <IconButton icon={Ellipsis} label={`Actions for ${t.key}`} />}
        pagination={{ page, pageSize: PAGE_SIZE, total: demoTasks.length, onPageChange: setPage }}
      />
      <Table
        caption={`Archived tasks (${theme})`}
        columns={taskColumns}
        rows={[]}
        getRowKey={(t) => t.key}
        empty={<EmptyState icon={Archive} title="No archived tasks." />}
      />
    </Section>
  );
}
