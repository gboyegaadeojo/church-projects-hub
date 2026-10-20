import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { FEEDBACK_COPY, NEWS_BODY_MAX, NEWS_TITLE_MAX, type NewsItem, newsResponse } from "../../shared/feedback";
import { NEWS_UNREAD_KEY } from "../components/HelpMenu";
import { Markdown } from "../components/Markdown";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Button } from "../components/ui/Button";
import { Dialog, DialogContent } from "../components/ui/Dialog";
import { Field } from "../components/ui/Field";
import { Textarea, TextInput } from "../components/ui/inputs";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { toast } from "../components/ui/Toast";
import { api } from "../lib/api";

// What's New (FDBK-1, section 11.9): dated release notes, newest first. App Admins get "New post" with a
// simple Markdown form. Opening the page clears the Help menu's dot (user_news_seen).

const QUERY_KEY = ["news"];
const SAVE_FAILED = "We couldn't save this change. Check your connection and try again.";

export function WhatsNewPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const news = useQuery({ queryKey: QUERY_KEY, queryFn: async () => newsResponse.parse(await api("/api/news")) });
  const showSkeleton = useDelayedFlag(news.isPending);
  const [editing, setEditing] = useState<NewsItem | "new" | null>(null);
  const newestId = news.data?.items[0]?.id;

  // Seen once the entries have loaded, so the dot clears only when there was something to read.
  useEffect(() => {
    if (newestId === undefined) return;
    void api("/api/news/seen", { method: "POST", csrfToken: me.csrfToken })
      .then(() => queryClient.setQueryData(NEWS_UNREAD_KEY, false))
      .catch(() => undefined);
  }, [newestId, me.csrfToken, queryClient]);

  const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: me.user.timezone });

  return (
    <PageLayout
      title="What's New"
      actions={
        news.data?.canPublish && (
          <Button icon={Plus} onClick={() => setEditing("new")}>
            New post
          </Button>
        )
      }
    >
      {news.isPending ? (
        <div aria-busy="true" aria-label="Loading What's New" className="flex flex-col gap-3">
          {showSkeleton && [0, 1].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : news.isError ? (
        <ErrorState title="We couldn't load What's New." description="Check your connection and try again." onRetry={() => void news.refetch()} retrying={news.isFetching} />
      ) : news.data.items.length === 0 ? (
        <EmptyState icon={Sparkles} title={FEEDBACK_COPY.newsEmpty} />
      ) : (
        <ol className="flex flex-col gap-group">
          {news.data.items.map((item) => (
            <li key={item.id}>
              <article aria-labelledby={`news-${item.id}`} className="flex flex-col gap-3 rounded-card border border-line bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <time dateTime={new Date(item.publishedAt).toISOString()} className="text-caption text-ink-2">
                      {dateFormat.format(item.publishedAt)}
                    </time>
                    <h2 id={`news-${item.id}`} className="text-body font-semibold text-ink">
                      {item.title}
                    </h2>
                  </div>
                  {news.data.canPublish && (
                    <Button variant="ghost" icon={Pencil} onClick={() => setEditing(item)}>
                      Edit
                    </Button>
                  )}
                </div>
                <Markdown source={item.bodyMd} />
              </article>
            </li>
          ))}
        </ol>
      )}
      {editing && <NewsForm key={editing === "new" ? "new" : editing.id} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </PageLayout>
  );
}

function NewsForm({ item, onClose }: { item: NewsItem | null; onClose: () => void }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.bodyMd ?? "");
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({});
  const save = useMutation({
    mutationFn: () =>
      api(item ? `/api/news/${item.id}` : "/api/news", { method: item ? "PATCH" : "POST", body: { title, bodyMd: body }, csrfToken: me.csrfToken }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ variant: "success", title: item ? "Saved." : "Post published." });
      onClose();
    },
    onError: () => toast({ variant: "error", title: SAVE_FAILED }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!title.trim()) next.title = "Add a title.";
    if (!body.trim()) next.body = "Write what changed.";
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={item ? "Edit post" : "New post"} className="max-w-2xl">
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <Field label="Title" error={errors.title} required>
            <TextInput value={title} maxLength={NEWS_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="What changed" hint="Markdown: **bold**, [link](https://…), and lines starting with - for a list." error={errors.body} required>
            <Textarea value={body} rows={8} maxLength={NEWS_BODY_MAX} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {body.trim() && (
            <section aria-label="Preview" className="flex flex-col gap-2 rounded-control border border-line p-3">
              <p className="text-caption font-medium text-ink-2">Preview</p>
              <Markdown source={body} />
            </section>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {item ? "Save" : "Publish"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
