import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "./cn.js";
import { EmptyState } from "./EmptyState.js";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Render ô. */
  cell: (row: T, index: number) => ReactNode;
  /** Căn phải (dữ liệu số). */
  numeric?: boolean;
  /** Cho phép sort — cần sortValue. */
  sortable?: boolean;
  sortValue?: (row: T) => number | string;
  width?: string;
  className?: string;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  empty?: { title: string; description?: string; icon?: ReactNode };
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  /** data-testid cho từng dòng (E2E/UAT). */
  rowTestId?: (row: T, index: number) => string;
  className?: string;
  /** compact = padding nhỏ (bảng dài). */
  density?: "comfortable" | "compact";
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  sort,
  onSort,
  onRowClick,
  rowTestId,
  className,
  density = "comfortable",
}: TableProps<T>) {
  const cellPad = density === "compact" ? "px-3 py-1.5" : "px-3.5 py-2.5";

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface shadow-xs", className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-alt">
            <tr className="border-b border-border">
              {columns.map((col) => {
                const active = sort?.key === col.key;
                const sortable = col.sortable && onSort;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    className={cn(
                      "text-xs font-semibold text-text-muted",
                      cellPad,
                      col.numeric ? "text-right" : "text-left",
                      sortable && "cursor-pointer select-none hover:text-text",
                    )}
                    onClick={sortable ? () => onSort(col.key) : undefined}
                  >
                    <span className={cn("inline-flex items-center gap-1", col.numeric && "flex-row-reverse")}>
                      {col.header}
                      {sortable &&
                        (active ? (
                          sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 text-text-subtle" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border last:border-0">
                  {columns.map((col) => (
                    <td key={col.key} className={cellPad}>
                      <div className="h-3.5 animate-pulse rounded bg-surface-alt" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  data-testid={rowTestId ? rowTestId(row, i) : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-border last:border-0 transition-colors",
                    i % 2 === 1 && "bg-surface-alt/40",
                    onRowClick && "cursor-pointer hover:bg-accent-subtle/60",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(cellPad, col.numeric ? "text-right tabular" : "text-left", "text-text", col.className)}
                    >
                      {col.cell(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && (
        <EmptyState
          className="rounded-none border-0"
          title={empty?.title ?? "Chưa có dữ liệu"}
          {...(empty?.description ? { description: empty.description } : {})}
          {...(empty?.icon ? { icon: empty.icon } : {})}
        />
      )}
    </div>
  );
}
