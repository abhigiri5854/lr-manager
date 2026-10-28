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
};

// th/td rules from the <style> block in Register.dc.html.
const th =
  "border-b border-border px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap text-muted";
const td = "border-b border-border-row p-3 text-sm whitespace-nowrap";

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
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx(th, c.align === "right" ? "text-right" : "text-left")}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={cx(td, "text-muted")}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr key={rowKey(row)} className={cx(href && "relative hover:bg-surface-subtle")}>
                  {columns.map((c, i) => {
                    const content = c.cell(row);
                    return (
                      <td
                        key={c.key}
                        className={cx(
                          td,
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
