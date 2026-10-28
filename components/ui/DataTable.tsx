import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** IBM Plex Mono — LR no., GSTIN, truck no. */
  mono?: boolean;
  /** Let long text wrap, cut off after 2 lines (other cells never wrap). Kept wider on phones, where the table scrolls anyway. */
  wrap?: boolean;
};

type DataTableProps<T> = {
  /** Screen-reader name for the table. */
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /**
   * Makes each row open this URL. The first column becomes a link and the
   * whole row is clickable. Other links/buttons in the row need `relative z-10`.
   */
  rowHref?: (row: T) => string;
  /** Shown in a single row when there is no data. */
  empty?: ReactNode;
  /** "compact": 10px cell padding (Invoice.dc.html) for tables that share the row with a sidebar. */
  density?: "default" | "compact";
};

// th/td rules from the <style> blocks in Register.dc.html (default) and Invoice.dc.html (compact).
const th = "border-b border-border py-2.5 text-[13px] font-semibold text-muted";
const td = "border-b border-border-row text-sm";
const pad = {
  default: { th: "px-3", td: "p-3" },
  compact: { th: "px-2.5", td: "p-2.5" },
};

/**
 * Table that scrolls sideways when it doesn't fit (phones). Put it in
 * <Card padding="table"> to get the Register look.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  rowHref,
  empty = "Nothing here yet.",
  density = "default",
}: DataTableProps<T>) {
  const p = pad[density];
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx(
                  th,
                  p.th,
                  !c.wrap && "whitespace-nowrap",
                  c.align === "right" ? "text-right" : "text-left",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={cx(td, p.td, "text-muted")}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr key={rowKey(row)} className={cx(href && "relative hover:bg-surface-subtle")}>
                  {columns.map((c, i) => {
                    const cell = c.cell(row);
                    const content = c.wrap ? <div className="line-clamp-2">{cell}</div> : cell;
                    return (
                      <td
                        key={c.key}
                        className={cx(
                          td,
                          p.td,
                          c.wrap ? "min-w-40 sm:min-w-24" : "whitespace-nowrap",
                          c.align === "right" && "text-right",
                          c.mono && "font-mono",
                        )}
                      >
                        {href && i === 0 ? (
                          // after: overlay stretches the link over the whole row.
                          <Link href={href} className="after:absolute after:inset-0">
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
