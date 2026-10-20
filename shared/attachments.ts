// File attachments (TASK-5, section 11.4) — rules shared by the Worker and the app.

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Keeps one task from eating the free R2 allowance. */
export const ATTACHMENTS_PER_TASK = 25;

export const ATTACHMENT_TYPES = {
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/gif": "GIF image",
  "image/webp": "WebP image",
  "application/pdf": "PDF",
} as const;
export type AttachmentMime = keyof typeof ATTACHMENT_TYPES;

export const ACCEPT_ATTRIBUTE = ".jpg,.jpeg,.png,.gif,.webp,.pdf,image/jpeg,image/png,image/gif,image/webp,application/pdf";

/** Exact copy from sections 11.4 and 14. */
export const ATTACHMENT_COPY = {
  tooLarge: "This file is too large. Maximum size is 10 MB.",
  unsupported: "Only images and PDFs are supported.",
  uploadFailed: "Upload failed. Try again.",
  dataSafety: "Don't upload children's details or confidential pastoral information.",
  tooMany: "This task has the maximum number of files. Delete one to add another.",
  deleted: "File deleted.",
} as const;

export const ATTACHMENT_ERRORS = { tooLarge: "too_large", unsupported: "unsupported_type", tooMany: "too_many" } as const;

/** Header carrying the original file name, URI-encoded (the body is the raw file). */
export const FILENAME_HEADER = "X-Filename";

/**
 * The file's real type from its first bytes (section 11.4: not only its name). Null if it isn't one we accept.
 */
export function sniffMime(bytes: Uint8Array): AttachmentMime | null {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

/** Client-side check before uploading (the server checks again from the bytes). */
export function precheckFile(file: { name: string; size: number; type: string }): string | null {
  if (file.size > ATTACHMENT_MAX_BYTES) return ATTACHMENT_COPY.tooLarge;
  const typeOk = file.type in ATTACHMENT_TYPES;
  const extOk = /\.(jpe?g|png|gif|webp|pdf)$/i.test(file.name);
  if (!typeOk && !extOk) return ATTACHMENT_COPY.unsupported;
  return null;
}

/** Safe display and download name: no paths or control characters, at most 120 characters. */
export function cleanFilename(raw: string): string {
  const name = raw
    .replace(/[\\/]/g, "_")
    // biome-ignore lint: control characters are exactly what is being removed
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .slice(-120);
  return name || "file";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
