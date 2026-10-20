import { type Context, Hono } from "hono";
import { AUDIT_EXPORT_CAP, AUDIT_PAGE_SIZE, type AuditEntry } from "../../shared/admin";
import { AUDIT } from "../audit";
import { requirePermission } from "../auth/authorize";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../types";

// The audit log (ADM-3, section 11.12): append-only in the UI, searchable by actor, action type and date
// range, exportable to CSV. App Admins only ("Read audit log", "Export audit log to CSV"). The export streams
// in chunks so a large log stays inside the Worker's CPU and memory limits (NFR-22), capped at 5,000 rows.

type Row = { id: number; at: number; action: string; actor_id: number | null; actor_name: string | null; target_type: string; target_id: string; detail_json: string };

/** The filters shared by the page and the export. Everything is bound; nothing from the query becomes SQL. */
function filters(c: Context<AppEnv>) {
  const where: string[] = [];
  const bind: unknown[] = [];
  /** Binds `value` and returns its placeholder (?1, ?2, …). */
  const param = (value: unknown) => `?${bind.push(value)}`;
  const actor = (c.req.query("actor") ?? "").trim().toLowerCase().slice(0, 100);
  if (actor) {
    const p = param(`%${actor.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    where.push(`(lower(u.name) LIKE ${p} ESCAPE '\\' OR lower(u.email) LIKE ${p} ESCAPE '\\')`);
  }
  const action = c.req.query("action");
  if (action) where.push(`a.action = ${param(action)}`);
  const from = Number(c.req.query("from"));
  if (Number.isFinite(from) && from > 0) where.push(`a.at >= ${param(from)}`);
  const to = Number(c.req.query("to"));
  if (Number.isFinite(to) && to > 0) where.push(`a.at < ${param(to)}`);
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", bind };
}

const SELECT = `SELECT a.id, a.at, a.action, a.actor_id, u.name AS actor_name, a.target_type, a.target_id, a.detail_json
  FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id`;

function toEntry(r: Row): AuditEntry {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(r.detail_json) as Record<string, unknown>;
  } catch {
    // Kept as written; shown empty rather than failing the page.
  }
  return {
    id: r.id,
    at: r.at,
    action: r.action,
    actor: r.actor_id === null ? null : { id: r.actor_id, name: r.actor_name ?? "Deleted user" },
    targetType: r.target_type,
    targetId: r.target_id,
    detail,
  };
}

/** RFC 4180 field; a leading =, +, - or @ is prefixed so spreadsheets never run it as a formula. */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function adminAuditRoutes() {
  const routes = new Hono<AppEnv>();

  // Newest first, 50 at a time; ?before=<id> pages back.
  routes.get("/admin/audit", requireSession, requirePermission("audit.read"), async (c) => {
    const { where, bind } = filters(c);
    const before = Number(c.req.query("before"));
    const cursor = Number.isSafeInteger(before) && before > 0 ? `${where ? " AND" : "WHERE"} a.id < ?${bind.length + 1}` : "";
    const { results } = await c.env.DB.prepare(`${SELECT} ${where}${cursor} ORDER BY a.id DESC LIMIT ${AUDIT_PAGE_SIZE + 1}`)
      .bind(...bind, ...(cursor ? [before] : []))
      .all<Row>();
    const page = results.slice(0, AUDIT_PAGE_SIZE);
    return c.json({
      entries: page.map(toEntry),
      nextBefore: results.length > AUDIT_PAGE_SIZE ? page.at(-1)!.id : null,
      actions: Object.values(AUDIT).sort(),
    });
  });

  routes.get("/admin/audit.csv", requireSession, requirePermission("audit.export"), async (c) => {
    const { where, bind } = filters(c);
    const db = c.env.DB;
    const encoder = new TextEncoder();
    const CHUNK = 500;
    let sent = 0;
    let before = Number.MAX_SAFE_INTEGER;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("﻿time_utc,action,actor_id,actor_name,target_type,target_id,detail\r\n"));
      },
      async pull(controller) {
        const limit = Math.min(CHUNK, AUDIT_EXPORT_CAP - sent);
        const { results } = await db
          .prepare(`${SELECT} ${where}${where ? " AND" : "WHERE"} a.id < ?${bind.length + 1} ORDER BY a.id DESC LIMIT ${limit}`)
          .bind(...bind, before)
          .all<Row>();
        const lines = results.map((r) =>
          [new Date(r.at).toISOString(), r.action, r.actor_id, r.actor_name, r.target_type, r.target_id, r.detail_json].map(csvField).join(","),
        );
        if (lines.length) controller.enqueue(encoder.encode(`${lines.join("\r\n")}\r\n`));
        sent += results.length;
        before = results.at(-1)?.id ?? before;
        if (results.length < limit || sent >= AUDIT_EXPORT_CAP) controller.close();
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });

  return routes;
}
