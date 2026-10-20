import { type NotificationPayload, type NotificationType } from "../../shared/notifications";

// Email content (section 8 "Email design"): plain layout, the church's name, a one-line subject like
// "Sam assigned you MEDIA-42: Replace stage left DI box", the task, its project and due date, one button, and
// a footer with notification settings and one-click unsubscribe. Every value is HTML-escaped; nothing from a
// person is ever inserted as HTML.

export type EmailTemplate = NotificationType | "invite" | "digest";
export type Rendered = { subject: string; html: string; text: string };
export type Links = { base: string; settings: string; unsubscribe: string | null; oneClick?: string | null };

type Payload = NotificationPayload & { actorName?: string | null; link?: string; role?: string; expiresAt?: number; count?: number };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

const ROLE_WORDS: Record<string, string> = { admin: "Project Admin", contributor: "Contributor", viewer: "Viewer" };

function formatDue(date: string | null | undefined): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y!, m! - 1, d!));
}

/** The line, extra details and button for one event; used alone (instant) or as an item in a digest. */
export function eventContent(template: EmailTemplate, p: Payload, base: string): { line: string; details: string[]; button: { label: string; href: string } } {
  const who = p.actorName ?? "Someone";
  const task = p.taskKey ? `${p.taskKey}${p.taskTitle ? `: ${p.taskTitle}` : ""}` : "a task";
  const taskHref = p.taskKey && p.projectKey ? `${base}/projects/${p.projectKey}?task=${p.taskKey}` : `${base}/work`;
  const due = formatDue(p.dueDate);
  const taskDetails = [p.projectName ? `Project: ${p.projectName}` : null, due ? `Due: ${due}` : null].filter((x): x is string => !!x);
  const open = { label: "Open task", href: taskHref };
  switch (template) {
    case "task.assigned":
      return { line: `${who} assigned you ${task}`, details: taskDetails, button: open };
    case "task.mentioned":
      return { line: `${who} mentioned you in ${task}`, details: taskDetails, button: open };
    case "task.commented":
      return { line: `${who} commented on ${task}`, details: taskDetails, button: open };
    case "task.status_changed":
      return { line: `${task} moved to ${p.stateName ?? "a new column"}`, details: [`Moved by ${who}`, ...taskDetails], button: open };
    case "task.due_soon":
      return { line: `${task} is due in 7 days`, details: taskDetails, button: open };
    case "task.due_tomorrow":
      return { line: `${task} is due tomorrow`, details: taskDetails, button: open };
    case "task.overdue":
      return { line: `${task} is overdue`, details: taskDetails, button: open };
    case "access.requested":
      return { line: `${who} asked to join ${p.projectName ?? "a project"}`, details: [], button: { label: "Review requests", href: `${base}/admin/requests` } };
    case "access.nudge":
      return { line: `${who} is still waiting to join ${p.projectName ?? "a project"}`, details: [], button: { label: "Review requests", href: `${base}/admin/requests` } };
    case "access.reminder":
      return {
        line: `${p.count ?? "Some"} access ${p.count === 1 ? "request has" : "requests have"} waited more than 3 days`,
        details: [],
        button: { label: "Review requests", href: `${base}/admin/requests` },
      };
    case "access.decided":
      return p.decision === "approved"
        ? { line: `You've been added to ${p.projectName ?? "a project"}`, details: [], button: { label: "Open the project", href: `${base}/projects/${p.projectKey ?? ""}` } }
        : {
            line: `Your request to join ${p.projectName ?? "the project"} was declined`,
            details: p.reason ? [`Reason: ${p.reason}`] : [],
            button: { label: "See your requests", href: `${base}/request-access` },
          };
    case "session.revoked":
      return {
        line: "An app admin signed you out of Church Projects Hub on all your devices",
        details: ["You can sign in again with your Google account. If you didn't expect this, contact an app administrator."],
        button: { label: "Sign in", href: base },
      };
    case "feedback.status_changed":
      return {
        line: `Your feedback ${task} moved to ${p.stateName ?? "a new status"}`,
        details: [],
        button: { label: "See your feedback", href: `${base}/feedback` },
      };
    case "project.weekly_summary":
      return { line: `Weekly summary for ${p.projectName ?? "your project"}`, details: [], button: { label: "Open the project", href: `${base}/projects/${p.projectKey ?? ""}` } };
    case "invite":
      return {
        line: `${who} invited you to join ${p.projectName ?? "a project"} as ${ROLE_WORDS[p.role ?? ""] ?? "a member"}`,
        details: ["Sign in with Google using this email address to accept. The link works once and expires in 7 days."],
        button: { label: "Accept the invitation", href: p.link ?? base },
      };
    case "digest":
      return { line: "Your daily summary", details: [], button: { label: "Open My Work", href: `${base}/work` } };
  }
}

const COLORS = { ink: "#1f2937", muted: "#4b5563", line: "#e5e7eb", accent: "#2563eb", page: "#f6f7f9" };

function layout(inner: string, links: Links): string {
  return `<!doctype html><html lang="en"><body style="margin:0;padding:0;background:${COLORS.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${COLORS.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.page};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${COLORS.line};border-radius:12px">
<tr><td style="padding:24px 24px 8px;font-size:13px;font-weight:600;letter-spacing:0.04em;color:${COLORS.muted}">IMMANUEL FELLOWSHIP CHURCH · PROJECTS HUB</td></tr>
${inner}
<tr><td style="padding:16px 24px 24px;border-top:1px solid ${COLORS.line};font-size:12px;line-height:1.5;color:${COLORS.muted}">
You get this because of your notification settings.
<a href="${escapeHtml(links.settings)}" style="color:${COLORS.muted}">Change notification settings</a>${
    links.unsubscribe ? ` · <a href="${escapeHtml(links.unsubscribe)}" style="color:${COLORS.muted}">Unsubscribe from these emails</a>` : ""
  }
</td></tr></table></td></tr></table></body></html>`;
}

function block(line: string, details: string[], button: { label: string; href: string }): string {
  return `<tr><td style="padding:8px 24px 0;font-size:18px;line-height:1.4;font-weight:600">${escapeHtml(line)}</td></tr>
${details.map((d) => `<tr><td style="padding:6px 24px 0;font-size:15px;line-height:1.5;color:${COLORS.muted}">${escapeHtml(d)}</td></tr>`).join("\n")}
<tr><td style="padding:20px 24px 24px"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">${escapeHtml(button.label)}</a></td></tr>`;
}

function footerText(links: Links): string {
  return `\n\n--\nChange notification settings: ${links.settings}${links.unsubscribe ? `\nUnsubscribe from these emails: ${links.unsubscribe}` : ""}`;
}

export function renderEmail(template: EmailTemplate, payload: Payload, links: Links): Rendered {
  const { line, details, button } = eventContent(template, payload, links.base);
  // Subject: the one line, at most 120 characters.
  const subject = line.length > 120 ? `${line.slice(0, 117)}…` : line;
  return {
    subject,
    html: layout(block(line, details, button), links),
    text: `${line}\n${details.join("\n")}${details.length ? "\n" : ""}\n${button.label}: ${button.href}${footerText(links)}`,
  };
}

export type DigestItem = { template: EmailTemplate; payload: Payload };

/** NOTIF-5 / section 8: everything in digest mode since the last one, as one 7 am email. */
export function renderDigest(items: DigestItem[], links: Links): Rendered {
  const contents = items.map((i) => eventContent(i.template, i.payload, links.base));
  const subject = items.length === 1 ? contents[0]!.line : `Your daily summary: ${items.length} updates`;
  const rows = contents
    .map(
      (c) => `<tr><td style="padding:12px 24px 0;font-size:15px;line-height:1.5"><a href="${escapeHtml(c.button.href)}" style="color:${COLORS.ink};text-decoration:none;font-weight:600">${escapeHtml(c.line)}</a>${
        c.details.length ? `<br><span style="color:${COLORS.muted};font-size:13px">${c.details.map(escapeHtml).join(" · ")}</span>` : ""
      }</td></tr>`,
    )
    .join("\n");
  const html = layout(
    `<tr><td style="padding:8px 24px 0;font-size:18px;font-weight:600">Your daily summary</td></tr>${rows}
<tr><td style="padding:20px 24px 24px"><a href="${escapeHtml(links.base)}/work" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">Open My Work</a></td></tr>`,
    links,
  );
  const text = `Your daily summary\n\n${contents.map((c) => `- ${c.line}${c.details.length ? ` (${c.details.join(", ")})` : ""}\n  ${c.button.href}`).join("\n")}${footerText(links)}`;
  return { subject: subject.length > 120 ? `${subject.slice(0, 117)}…` : subject, html, text };
}
