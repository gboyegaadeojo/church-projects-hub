import { useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, RotateCcw, Trash2, Upload } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { ACCEPT_ATTRIBUTE, ATTACHMENT_COPY, ATTACHMENT_ERRORS, FILENAME_HEADER, formatBytes, precheckFile } from "../../../shared/attachments";
import { CSRF_HEADER } from "../../../shared/auth";
import { TASK_CONFIRM, type Attachment, type TaskDetail } from "../../../shared/tasks";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { taskKeyOf } from "../../lib/taskDetail";
import { Button, IconButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";

// File attachments (TASK-5, section 11.4): picker button and drop zone, progress per file, a retry on failure
// that doesn't block anything else, thumbnails for images and an icon for PDFs. Files open from
// /api/attachments/:id, which checks project membership on every request.

type Upload = { id: number; file: File; progress: number; error: string | null };

let uploadCounter = 0;

/** XHR rather than fetch: it reports upload progress. */
function uploadFile(taskId: number, file: File, csrfToken: string, onProgress: (pct: number) => void): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/tasks/${taskId}/attachments`);
    xhr.setRequestHeader(CSRF_HEADER, csrfToken);
    xhr.setRequestHeader(FILENAME_HEADER, encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: { attachment?: Attachment; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON: treated as a failure below.
      }
      if (xhr.status === 201 && body.attachment) resolve(body.attachment);
      else if (body.error === ATTACHMENT_ERRORS.tooLarge) reject(new Error(ATTACHMENT_COPY.tooLarge));
      else if (body.error === ATTACHMENT_ERRORS.unsupported) reject(new Error(ATTACHMENT_COPY.unsupported));
      else if (body.error === ATTACHMENT_ERRORS.tooMany) reject(new Error(ATTACHMENT_COPY.tooMany));
      else reject(new Error(ATTACHMENT_COPY.uploadFailed));
    };
    xhr.onerror = () => reject(new Error(ATTACHMENT_COPY.uploadFailed));
    xhr.send(file);
  });
}

/** Uploads files to a task just created (New task); returns how many failed. */
export async function uploadAll(taskId: number, files: File[], csrfToken: string): Promise<number> {
  let failed = 0;
  for (const file of files) {
    try {
      await uploadFile(taskId, file, csrfToken, () => {});
    } catch {
      failed++;
    }
  }
  return failed;
}

/** New task (v4.7): the same Files section, but files wait here until Create task, then upload to the new task. */
export function PendingFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [problems, setProblems] = useState<{ name: string; error: string }[]>([]);

  function add(list: FileList | File[]) {
    const ok: File[] = [];
    const bad: { name: string; error: string }[] = [];
    for (const file of Array.from(list)) {
      const problem = precheckFile(file);
      if (problem) bad.push({ name: file.name, error: problem });
      else ok.push(file);
    }
    setProblems(bad);
    if (ok.length) onChange([...files, ...ok]);
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-body font-semibold text-ink">Files</h3>
      {files.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Files to attach">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-control border border-line bg-card p-2">
              <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-chip bg-hover text-ink-2">
                <Icon icon={FileText} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-secondary font-medium text-ink">{f.name}</span>
                <span className="text-caption text-ink-2 tabular-nums">{formatBytes(f.size)} · uploads when the task is created</span>
              </span>
              <IconButton icon={Trash2} label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      )}
      {problems.map((p) => (
        <p key={p.name} role="alert" className="rounded-control border border-danger-line bg-danger-soft p-3 text-caption text-danger-ink">
          {p.name}: {p.error}
        </p>
      ))}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) add(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-control border border-dashed p-4 text-center transition-colors duration-(--duration-micro) ease-out",
          dragOver ? "border-accent bg-accent-soft" : "border-line-strong",
        )}
      >
        <Icon icon={Upload} className="text-ink-2" />
        <p className="text-secondary text-ink-2">Drop images or PDFs here, up to 10 MB each.</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files);
            e.target.value = "";
          }}
        />
        <Button variant="secondary" icon={Paperclip} onClick={() => input.current?.click()}>
          Attach files
        </Button>
        <p className="text-caption text-ink-2">{ATTACHMENT_COPY.dataSafety}</p>
      </div>
    </section>
  );
}

export function AttachmentSection({ task, canEdit, meId, isAdmin, csrfToken }: { task: TaskDetail; canEdit: boolean; meId: number; isAdmin: boolean; csrfToken: string }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [deleting, setDeleting] = useState<Attachment | null>(null);
  const busy = uploads.some((u) => u.error === null);

  const patch = (id: number, changes: Partial<Upload>) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...changes } : u)));

  async function start(upload: Upload) {
    patch(upload.id, { progress: 0, error: null });
    try {
      await uploadFile(task.id, upload.file, csrfToken, (progress) => patch(upload.id, { progress }));
      setUploads((list) => list.filter((u) => u.id !== upload.id));
      await queryClient.invalidateQueries({ queryKey: taskKeyOf(task.key) });
    } catch (err) {
      patch(upload.id, { error: err instanceof Error ? err.message : ATTACHMENT_COPY.uploadFailed });
    }
  }

  function add(files: FileList | File[]) {
    const next: Upload[] = [];
    for (const file of Array.from(files)) {
      const problem = precheckFile(file);
      next.push({ id: ++uploadCounter, file, progress: 0, error: problem });
    }
    setUploads((list) => [...list, ...next]);
    for (const u of next) if (u.error === null) void start(u);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (canEdit && e.dataTransfer.files.length) add(e.dataTransfer.files);
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-body font-semibold text-ink">Files</h3>
      {task.attachments.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {task.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-control border border-line bg-card p-2">
              <a
                href={`/api/attachments/${a.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-chip"
              >
                {a.mime.startsWith("image/") ? (
                  <img src={`/api/attachments/${a.id}`} alt="" loading="lazy" className="size-12 shrink-0 rounded-chip object-cover" />
                ) : (
                  <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-chip bg-hover text-ink-2">
                    <Icon icon={FileText} />
                  </span>
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-secondary font-medium text-ink">{a.filename}</span>
                  <span className="text-caption text-ink-2 tabular-nums">
                    {a.mime === "application/pdf" ? "PDF" : "Image"} · {formatBytes(a.bytes)}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </span>
                </span>
              </a>
              {canEdit && (a.uploadedBy === meId || isAdmin) && <IconButton icon={Trash2} label={`Delete ${a.filename}`} onClick={() => setDeleting(a)} />}
            </li>
          ))}
        </ul>
      )}

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Uploads">
          {uploads.map((u) => (
            <li key={u.id} className={cn("flex flex-col gap-2 rounded-control border p-3", u.error ? "border-danger-line bg-danger-soft" : "border-line bg-card")}>
              <span className="flex items-center justify-between gap-2 text-secondary text-ink">
                <span className="truncate">{u.file.name}</span>
                {!u.error && <span className="text-ink-2 tabular-nums">{u.progress}%</span>}
              </span>
              {u.error ? (
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span role="alert" className="text-caption text-danger-ink">
                    {u.error}
                  </span>
                  <span className="flex gap-1">
                    {u.error === ATTACHMENT_COPY.uploadFailed && (
                      <Button variant="secondary" icon={RotateCcw} onClick={() => void start(u)}>
                        Retry
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}>
                      Dismiss
                    </Button>
                  </span>
                </span>
              ) : (
                <div
                  role="progressbar"
                  aria-label={`Uploading ${u.file.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={u.progress}
                  className="h-1.5 overflow-hidden rounded-full bg-hover"
                >
                  <div className="h-full rounded-full bg-accent transition-[width] duration-(--duration-micro) ease-out" style={{ width: `${u.progress}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-2 rounded-control border border-dashed p-4 text-center transition-colors duration-(--duration-micro) ease-out",
            dragOver ? "border-accent bg-accent-soft" : "border-line-strong",
          )}
        >
          <Icon icon={Upload} className="text-ink-2" />
          <p className="text-secondary text-ink-2">Drop images or PDFs here, up to 10 MB each.</p>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              if (e.target.files?.length) add(e.target.files);
              e.target.value = "";
            }}
          />
          <Button variant="secondary" icon={Paperclip} disabled={busy} onClick={() => input.current?.click()}>
            Attach files
          </Button>
          <p className="text-caption text-ink-2">{ATTACHMENT_COPY.dataSafety}</p>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.filename ?? "this file"}?`}
        description="This removes the file from the task for everyone."
        confirmLabel="Delete file"
        confirmIcon={Trash2}
        confirmAction={TASK_CONFIRM.deleteAttachment}
        successMessage={ATTACHMENT_COPY.deleted}
        onConfirm={async (headers) => {
          await api(`/api/attachments/${deleting!.id}`, { method: "DELETE", csrfToken, headers });
          await queryClient.invalidateQueries({ queryKey: taskKeyOf(task.key) });
        }}
      />
    </section>
  );
}
