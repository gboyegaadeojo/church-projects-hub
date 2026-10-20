// Daily clean-up of attachment objects in R2 (section 11.4). Two cases:
// 1. A deleted attachment whose object delete failed (deleted_at set, purged_at not).
// 2. An object with no row at all (the upload's row insert failed). Objects younger than a day are left
//    alone so an upload in flight is never touched.
// Bounded per run (NFR-22): at most PAGES listing pages and BATCH deleted rows.

const PREFIX = "attachments/";
const BATCH = 100;
const PAGES = 5;
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

export async function cleanOrphanedAttachments(env: Pick<Env, "DB" | "FILES">, now = Date.now()): Promise<{ purged: number; orphans: number }> {
  const { results: deleted } = await env.DB.prepare(
    "SELECT id, r2_key FROM attachments WHERE deleted_at IS NOT NULL AND purged_at IS NULL LIMIT ?1",
  )
    .bind(BATCH)
    .all<{ id: number; r2_key: string }>();
  if (deleted.length > 0) {
    await env.FILES.delete(deleted.map((d) => d.r2_key));
    await env.DB.prepare("UPDATE attachments SET purged_at = ?2 WHERE id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(deleted.map((d) => d.id)), now)
      .run();
  }

  let orphans = 0;
  let cursor: string | undefined;
  for (let page = 0; page < PAGES; page++) {
    const listing = await env.FILES.list({ prefix: PREFIX, cursor, limit: 1000 });
    const old = listing.objects.filter((o) => now - o.uploaded.getTime() > MIN_AGE_MS).map((o) => o.key);
    if (old.length > 0) {
      const { results } = await env.DB.prepare("SELECT r2_key FROM attachments WHERE r2_key IN (SELECT value FROM json_each(?1))")
        .bind(JSON.stringify(old))
        .all<{ r2_key: string }>();
      const known = new Set(results.map((r) => r.r2_key));
      const missing = old.filter((k) => !known.has(k));
      if (missing.length > 0) {
        await env.FILES.delete(missing);
        orphans += missing.length;
      }
    }
    if (!listing.truncated) break;
    cursor = listing.cursor;
  }
  return { purged: deleted.length, orphans };
}
