import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ATTACHMENT_MAX_BYTES, sniffMime } from "../shared/attachments";
import { type Attachment, TASK_CONFIRM, type TaskDetail } from "../shared/tasks";
import { cleanOrphanedAttachments } from "../worker/jobs/orphans";
import { call, type Client, request } from "./helpers/auth";
import { actorAs, auditFor, createProject, MATRIX_ROLES, type MatrixRole } from "./helpers/fixtures";

// TASK-5 / section 11.4 against the real API, D1 and R2 (Miniflare).

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%test\n");

let project: { id: number };
let actors: Record<MatrixRole, Client>;
let task: TaskDetail;

beforeAll(async () => {
  project = await createProject();
  await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, 'To Do', 'todo', 0)").bind(project.id).run();
  actors = {} as Record<MatrixRole, Client>;
  for (const role of MATRIX_ROLES) actors[role] = await actorAs(role, project.id);
  const res = await call(actors.contributor, "POST", `/api/projects/${project.id}/tasks`, { title: "Stage plot" });
  task = ((await res.json()) as { task: TaskDetail }).task;
});

function upload(client: Client, body: Uint8Array, filename: string, taskId = task.id) {
  return request(`/api/tasks/${taskId}/attachments`, {
    method: "POST",
    ip: client.ip,
    cookie: client.cookie,
    headers: { "X-CSRF-Token": client.csrfToken, "X-Filename": encodeURIComponent(filename), "Content-Type": "application/octet-stream" },
    body,
  });
}

function download(client: Client, id: number) {
  return request(`/api/attachments/${id}`, { ip: client.ip, cookie: client.cookie });
}

describe("TASK-5 / Section 11.4 attachments", () => {
  it("checks the type from the first bytes, not the name", () => {
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffMime(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffMime(new TextEncoder().encode("<html><script>"))).toBeNull();
  });

  it("uploads to R2 through the Worker, records it and serves it only to people who can see the task", async () => {
    // A PNG named .pdf is stored as what it really is.
    const res = await upload(actors.contributor, PNG, "../../stage plot.pdf");
    expect(res.status).toBe(201);
    const { attachment } = (await res.json()) as { attachment: Attachment };
    expect(attachment).toMatchObject({ mime: "image/png", bytes: PNG.byteLength, filename: ".._.._stage plot.pdf", uploadedBy: actors.contributor.userId });

    const file = await download(actors.viewer, attachment.id);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("image/png");
    expect(file.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(file.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);

    const outsider = await actorAs("contributor", (await createProject()).id);
    expect((await download(outsider, attachment.id)).status).toBe(403);
    expect((await download(actors.pending, attachment.id)).status).toBe(403);

    const detail = ((await (await call(actors.viewer, "GET", `/api/tasks/${task.id}`)).json()) as { task: TaskDetail }).task;
    expect(detail.attachments.map((a) => a.id)).toContain(attachment.id);
    expect(detail.events.at(-1)).toMatchObject({ field: "attachment_added" });
  });

  it("refuses other file types, files over 10 MB, and people who can't edit the task", async () => {
    expect((await upload(actors.contributor, new TextEncoder().encode("<svg onload=alert(1)>"), "x.png")).status).toBe(415);
    expect((await upload(actors.contributor, new Uint8Array(0), "empty.pdf")).status).toBe(415);
    const big = new Uint8Array(ATTACHMENT_MAX_BYTES + 1);
    big.set(PDF);
    expect((await upload(actors.contributor, big, "big.pdf")).status).toBe(413);
    expect((await upload(actors.viewer, PDF, "notes.pdf")).status).toBe(403);
    expect((await upload(actors.pending, PDF, "notes.pdf")).status).toBe(403);
  });

  it("delete: confirmation, uploader or admin only, row then object, audited", async () => {
    const { attachment } = (await (await upload(actors.contributor, PDF, "run sheet.pdf")).json()) as { attachment: Attachment };
    const row = await env.DB.prepare("SELECT r2_key FROM attachments WHERE id = ?").bind(attachment.id).first<{ r2_key: string }>();
    expect(await env.FILES.head(row!.r2_key)).not.toBeNull();
    const confirm = { "X-Confirm-Action": TASK_CONFIRM.deleteAttachment };

    expect((await call(actors.contributor, "DELETE", `/api/attachments/${attachment.id}`)).status).toBe(428);
    expect((await call(actors.viewer, "DELETE", `/api/attachments/${attachment.id}`, undefined, confirm)).status).toBe(403);
    const other = await actorAs("contributor", project.id);
    expect((await call(other, "DELETE", `/api/attachments/${attachment.id}`, undefined, confirm)).status).toBe(403);
    expect((await call(actors.projectAdmin, "DELETE", `/api/attachments/${attachment.id}`, undefined, confirm)).status).toBe(200);

    expect(await env.FILES.head(row!.r2_key)).toBeNull();
    const after = await env.DB.prepare("SELECT deleted_at, purged_at FROM attachments WHERE id = ?").bind(attachment.id).first<{ deleted_at: number; purged_at: number }>();
    expect(after!.deleted_at).toBeGreaterThan(0);
    expect(after!.purged_at).toBeGreaterThan(0);
    expect((await download(actors.contributor, attachment.id)).status).toBe(404);
    expect(await auditFor("attachment.deleted", attachment.id)).toHaveLength(1);
  });

  it("the daily clean-up removes objects left behind and objects with no row", async () => {
    const { attachment } = (await (await upload(actors.contributor, PDF, "left behind.pdf")).json()) as { attachment: Attachment };
    const row = await env.DB.prepare("SELECT r2_key FROM attachments WHERE id = ?").bind(attachment.id).first<{ r2_key: string }>();
    // As if the object delete had failed after the row was marked deleted.
    await env.DB.prepare("UPDATE attachments SET deleted_at = ? WHERE id = ?").bind(Date.now(), attachment.id).run();
    // As if an upload's row insert had failed.
    const strayKey = `attachments/${project.id}/${task.id}/stray-${crypto.randomUUID()}`;
    await env.FILES.put(strayKey, PDF);
    // A fresh object with no row yet (an upload in flight) is kept.
    const result = await cleanOrphanedAttachments(env);
    expect(await env.FILES.head(strayKey)).not.toBeNull();
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(await env.FILES.head(row!.r2_key)).toBeNull();

    // A day later it's an orphan and goes.
    await cleanOrphanedAttachments(env, Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(await env.FILES.head(strayKey)).toBeNull();
  });
});
