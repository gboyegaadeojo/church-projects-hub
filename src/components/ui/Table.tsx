import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";
import { Icon } from "./Icon";

// Tables (section 15): sortable headers where relevant, pagination for long lists,
// row actions always in the last column. Wide tables scroll inside their card, never the page.

export type SortDirection = "ascending" | "descending";
export type SortState = { key: string; direction: SortDirection };

export type Column<Row> = {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
  /** Right-align and use tabular numerals (counts, dates). */
  numeric?: boolean;
};

export type Pagination = {
  page: number; // 1-based
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

type TableProps<Row> = {
  /** Accessible name for the table; shown visually unless captionHidden. */
  caption: string;
  captionHidden?: boolean;
  columns: Column<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Row actions (usually an IconButton or Menu), rendered in the last column. */
  rowActions?: (row: Row) => ReactNode;
  pagination?: Pagination;
  /** Shown in place of rows when there are none (an EmptyState). */
  empty?: ReactNode;
};

function SortIcon({ direction }: { direction?: SortDirection }) {
  if (direction === "ascending") return <Icon icon={ChevronUp} size="sm" />;
  if (direction === "descending") return <Icon icon={ChevronDown} size="sm" />;
  return <Icon icon={ChevronsUpDown} size="sm" className="text-ink-2" />;
}

export function Table<Row>({
  caption,
  captionHidden,
  columns,
  rows,
  getRowKey,
  sort,
  onSortChange,
  rowActions,
  pagination,
  empty,
}: TableProps<Row>) {
  const columnCount = columns.length + (rowActions ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-left text-secondary">
          <caption className={cn("px-4 pt-3 text-left text-body font-medium text-ink", captionHidden && "sr-only")}>
            {caption}
          </caption>
          <thead>
            <tr className="border-b border-line">
              {columns.map((column) => {
                const active = sort?.key === column.key ? sort.direction : undefined;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={column.sortable ? (active ?? "none") : undefined}
                    className={cn("px-4 py-2 text-label text-ink-2", column.numeric && "text-right")}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() =>
                          onSortChange({
                            key: column.key,
                            direction: active === "ascending" ? "descending" : "ascending",
                          })
                        }
                        className={cn(
                          "-mx-2 inline-flex min-h-touch items-center gap-1 rounded-chip px-2 state-hover:bg-hover state-hover:text-ink",
                          active && "text-ink",
                        )}
                      >
                        {column.header}
                        <SortIcon direction={active} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {rowActions && (
                <th scope="col" className="w-0 px-4 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columnCount}>{empty}</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={getRowKey(row)}
                  className="border-b border-line transition-colors duration-(--duration-micro) ease-out last:border-b-0 state-hover:bg-hover"
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn("px-4 py-3 text-ink", column.numeric && "text-right tabular-nums")}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {rowActions && <td className="px-4 py-1 text-right">{rowActions(row)}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && <PaginationBar {...pagination} caption={caption} />}
    </div>
  );
}

function PaginationBar({ page, pageSize, total, onPageChange, caption }: Pagination & { caption: string }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav aria-label={`${caption} pages`} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-secondary text-ink-2 tabular-nums">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span className="px-1 text-secondary text-ink tabular-nums">
          Page {page} of {pageCount}
        </span>
        <Button variant="secondary" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          Next
          <Icon icon={ChevronRight} />
        </Button>
      </div>
    </nav>
  );
}
