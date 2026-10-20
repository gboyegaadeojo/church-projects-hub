import { Download, ListFilter } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { buttonClasses } from "../ui/Button";
import { Icon } from "../ui/Icon";

// Small, accessible charts for reports (section 16, dataviz rules): series colours are the validated
// --chart-1..3 tokens in a fixed order; text stays in ink colours; every chart has a legend or direct labels,
// a one-line summary, hover titles on each mark, and a table view, so nothing depends on colour alone.

export const SERIES = ["bg-chart-1", "bg-chart-2", "bg-chart-3"] as const;
const STROKES = ["stroke-chart-1", "stroke-chart-2", "stroke-chart-3"] as const;
const FILLS = ["fill-chart-1", "fill-chart-2", "fill-chart-3"] as const;
const n = new Intl.NumberFormat("en-CA");

/** A report card: title, summary, chart, optional table view, drill-down and CSV links. */
export function ReportCard({
  title,
  summary,
  children,
  table,
  viewTasks,
  csv,
  className,
}: {
  title: string;
  summary: ReactNode;
  children: ReactNode;
  table?: { head: string[]; rows: (string | number)[][] };
  viewTasks?: string;
  csv?: string;
  className?: string;
}) {
  const id = useId();
  const [showTable, setShowTable] = useState(false);
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3 rounded-card border border-line bg-card p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id={id} className="text-body font-semibold text-ink">
          {title}
        </h2>
        <div className="flex flex-wrap gap-1">
          {viewTasks && (
            <Link to={viewTasks} className={buttonClasses("ghost")}>
              <Icon icon={ListFilter} />
              View tasks
            </Link>
          )}
          {csv && (
            <a href={csv} download className={buttonClasses("ghost")} aria-label={`Download ${title} as CSV`}>
              <Icon icon={Download} />
              CSV
            </a>
          )}
        </div>
      </div>
      <p className="text-secondary text-ink-2">{summary}</p>
      {showTable && table ? <DataTable caption={title} head={table.head} rows={table.rows} /> : children}
      {table && table.rows.length > 0 && (
        <div>
          <button type="button" className="text-caption font-medium text-accent-ink underline" aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>
            {showTable ? "Show chart" : "Show as table"}
          </button>
        </div>
      )}
    </section>
  );
}

export function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-secondary">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-caption text-ink-2">
            {head.map((h, i) => (
              <th key={h} scope="col" className={cn("py-2 pr-4 font-medium", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((c, j) => (
                <td key={j} className={cn("py-2 pr-4 text-ink", j > 0 && "text-right tabular-nums")}>
                  {typeof c === "number" ? n.format(c) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One horizontal bar split into segments (2px gaps), with a legend that carries the numbers. */
export function StackedBar({ segments }: { segments: { label: string; value: number; href?: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-6 gap-0.5 overflow-hidden rounded-chip bg-line" aria-hidden="true">
        {total > 0 &&
          segments.map((s, i) =>
            s.value > 0 ? (
              <div key={s.label} className={cn("h-full first:rounded-l-chip last:rounded-r-chip", SERIES[i % 3])} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${n.format(s.value)}`} />
            ) : null,
          )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-secondary">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span aria-hidden="true" className={cn("size-3 rounded-sm", SERIES[i % 3])} />
            {s.href ? (
              <Link to={s.href} className="text-ink underline-offset-2 hover:underline">
                {s.label}
              </Link>
            ) : (
              <span className="text-ink">{s.label}</span>
            )}
            <span className="tabular-nums text-ink-2">
              {n.format(s.value)}
              {total > 0 && ` (${Math.round((s.value / total) * 100)}%)`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Several series over the same categories as lines on one axis, with end labels and per-point titles. */
export function LineChart({ labels, series, formatLabel }: { labels: string[]; series: { name: string; values: number[] }[]; formatLabel: (l: string) => string }) {
  // Drawn at the container's real width so text stays at its real size on phones.
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(260, Math.round(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 220;
  const pad = { l: 36, r: 96, t: 12, b: 28 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = Math.ceil(max / 4) || 1;
  const top = step * 4;
  const x = (i: number) => pad.l + (labels.length === 1 ? 0 : (i / (labels.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor((W - pad.l - pad.r) / 72))));
  // End labels, nudged apart when two lines finish within 14px of each other.
  const labelY = series.map((s) => y(s.values.at(-1) ?? 0) + 4);
  for (let i = 1; i < labelY.length; i++) if (Math.abs(labelY[i]! - labelY[i - 1]!) < 14) labelY[i] = labelY[i - 1]! + (labelY[i]! >= labelY[i - 1]! ? 14 : -14);
  return (
    <figure ref={box} className="flex flex-col gap-2">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="max-w-full" role="img" aria-label={series.map((s) => `${s.name}: ${s.values.reduce((a, b) => a + b, 0)} in total`).join("; ")}>
        {[0, 1, 2, 3, 4].map((k) => (
          <g key={k}>
            <line x1={pad.l} x2={W - pad.r} y1={y(k * step)} y2={y(k * step)} className="stroke-line" strokeWidth={1} />
            <text x={pad.l - 6} y={y(k * step) + 4} textAnchor="end" className="fill-ink-2 text-[11px]">
              {k * step}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 ? (
            <text key={l} x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-2 text-[11px]">
              {formatLabel(l)}
            </text>
          ) : null,
        )}
        {series.map((s, si) => (
          <g key={s.name}>
            <polyline fill="none" className={STROKES[si % 3]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={4} className={cn(FILLS[si % 3], "stroke-card")} strokeWidth={2}>
                <title>{`${s.name}, week of ${formatLabel(labels[i]!)}: ${v}`}</title>
              </circle>
            ))}
            {/* Direct label at the line's end (two series: also in the legend below). */}
            <text x={x(s.values.length - 1) + 10} y={labelY[si]} className="fill-ink text-[12px]">
              {s.name} {s.values.at(-1)}
            </text>
          </g>
        ))}
      </svg>
      {/* One series needs no legend: the card's title names it. */}
      {series.length > 1 && (
        <figcaption>
          <ul className="flex flex-wrap gap-x-5 text-secondary">
            {series.map((s, i) => (
              <li key={s.name} className="flex items-center gap-2 text-ink">
                <span aria-hidden="true" className={cn("h-0.5 w-4 rounded-full", SERIES[i % 3])} />
                {s.name}
              </li>
            ))}
          </ul>
        </figcaption>
      )}
    </figure>
  );
}

/** Horizontal bars, one row per item; one or two series side by side; numbers always written out. */
export function BarList({ rows, series }: { rows: { label: string; values: number[]; href?: string }[]; series: string[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  return (
    <div className="flex flex-col gap-3">
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-5 text-secondary">
          {series.map((s, i) => (
            <li key={s} className="flex items-center gap-2 text-ink">
              <span aria-hidden="true" className={cn("size-3 rounded-sm", SERIES[i % 3])} />
              {s}
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3">
            {r.href ? (
              <Link to={r.href} className="truncate text-secondary text-ink underline-offset-2 hover:underline">
                {r.label}
              </Link>
            ) : (
              <span className="truncate text-secondary text-ink">{r.label}</span>
            )}
            <span className="flex flex-col gap-0.5">
              {r.values.map((v, i) => (
                <span key={i} className="flex items-center gap-2">
                  <span
                    className={cn("h-3 rounded-r-sm", SERIES[i % 3], v === 0 && "w-0.5 opacity-40")}
                    style={v ? { width: `${(v / max) * 85}%` } : undefined}
                    title={`${r.label}, ${series[i]}: ${v}`}
                  />
                  <span className="text-caption tabular-nums text-ink-2">
                    {n.format(v)}
                    <span className="sr-only"> {series[i]}</span>
                  </span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(1, max)}
      aria-valuenow={value}
      aria-valuetext={`${value} of ${max} done`}
      className="h-2 overflow-hidden rounded-full bg-line"
    >
      <div className="h-full rounded-full bg-chart-1" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  );
}
