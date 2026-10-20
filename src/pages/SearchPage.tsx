import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, Search, SearchX } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { todayIn } from "../../shared/tasks";
import { SEARCH_DEBOUNCE_MS, SEARCH_MAX_QUERY, SEARCH_MIN_CHARS, searchResponse } from "../../shared/work";
import { ProjectGlyph, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { TypeIcon } from "../components/tasks/bits";
import { Icon } from "../components/ui/Icon";
import { TextInput } from "../components/ui/inputs";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { api } from "../lib/api";
import { taskLink, TaskRow } from "./WorkPage";

// Global search (NAV-1, section 11.11): tasks by key, title, description and comments through the FTS5 index,
// and projects by name, only from projects the person can see. Results after 2 characters, debounced 200 ms.
// A query shaped like a key (MEDIA-42) offers that task first; Enter goes straight to it.

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function SearchPage() {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get("q") ?? "");
  const q = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);
  const inputId = useId();
  const enabled = q.length >= SEARCH_MIN_CHARS;
  const results = useQuery({
    queryKey: ["search", q],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => searchResponse.parse(await api(`/api/search?q=${encodeURIComponent(q)}`)),
  });
  const showSkeleton = useDelayedFlag(enabled && results.isPending);
  const today = todayIn(me.user.timezone);

  // Keep the query in the URL, so Back returns to the same results.
  useEffect(() => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (q) next.set("q", q);
      else next.delete("q");
      return next;
    }, { replace: true });
  }, [q, setParams]);

  const data = enabled ? results.data : undefined;
  const nothing = data && !data.exact && data.tasks.length === 0 && data.projects.length === 0;

  return (
    <PageLayout title="Search">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (data?.exact) navigate(taskLink(data.exact));
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor={inputId} className="text-secondary font-medium text-ink">
          Search tasks and projects
        </label>
        <div className="relative">
          <Icon icon={Search} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-2" />
          <TextInput
            id={inputId}
            type="search"
            value={text}
            maxLength={SEARCH_MAX_QUERY}
            autoFocus
            autoComplete="off"
            placeholder="Title, words in a description or comment, or a key like MEDIA-42"
            onChange={(e) => setText(e.target.value)}
            className="pl-10"
          />
        </div>
        <p className="text-caption text-ink-2" aria-live="polite">
          {!enabled
            ? "Type at least 2 characters."
            : data
              ? nothing
                ? "No results."
                : `${(data.exact ? 1 : 0) + data.tasks.length} tasks, ${data.projects.length} projects.`
              : ""}
        </p>
      </form>

      {results.isError && enabled ? (
        <ErrorState title="Search didn't work." description="Check your connection and try again." onRetry={() => void results.refetch()} retrying={results.isFetching} />
      ) : showSkeleton ? (
        <div aria-busy="true" aria-label="Searching" className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : nothing ? (
        <EmptyState icon={SearchX} title={`Nothing matches “${q}”. Try fewer or different words.`} />
      ) : data ? (
        <div className="flex flex-col gap-group">
          {data.exact && (
            <section aria-labelledby="search-exact" className="flex flex-col gap-2">
              <h2 id="search-exact" className="text-body font-semibold text-ink">
                Go to {data.exact.key}
              </h2>
              <ul className="flex flex-col gap-2">
                <TaskRow task={data.exact} today={today} />
              </ul>
            </section>
          )}
          {data.projects.length > 0 && (
            <section aria-labelledby="search-projects" className="flex flex-col gap-2">
              <h2 id="search-projects" className="text-body font-semibold text-ink">
                Projects
              </h2>
              <ul className="flex flex-col gap-2">
                {data.projects.map((p) => (
                  <li key={p.key}>
                    <Link
                      to={`/projects/${p.key}`}
                      className="flex items-center gap-3 rounded-control border border-line bg-card px-3 py-2 state-hover:bg-hover"
                    >
                      <ProjectGlyph project={p} />
                      <span className="flex-1 text-secondary font-medium text-ink">{p.name}</span>
                      <span className="text-caption text-ink-2 tabular-nums">{p.key}</span>
                      <Icon icon={ArrowRight} size="sm" className="text-ink-2" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.tasks.length > 0 && (
            <section aria-labelledby="search-tasks" className="flex flex-col gap-2">
              <h2 id="search-tasks" className="text-body font-semibold text-ink">
                Tasks
              </h2>
              <ul className="flex flex-col gap-2">
                {data.tasks.map((t) => (
                  <li key={t.id}>
                    <Link to={taskLink(t)} className="flex flex-col gap-1 rounded-control border border-line bg-card px-3 py-2 state-hover:bg-hover">
                      <span className="flex items-center gap-2">
                        <ProjectGlyph project={t.project} size="sm" />
                        <span className="flex items-center gap-1 text-label text-ink-2 tabular-nums">
                          <TypeIcon type={t.type} />
                          {t.key}
                        </span>
                        <span className="text-secondary font-medium text-ink">{t.title}</span>
                        <span className="ml-auto text-caption text-ink-2">{t.stateName}</span>
                      </span>
                      {t.snippet.trim() && <span className="line-clamp-2 text-caption text-ink-2">{t.snippet}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}
    </PageLayout>
  );
}
