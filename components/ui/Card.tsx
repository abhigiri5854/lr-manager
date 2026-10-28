import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

type CardProps = {
  title?: ReactNode;
  /** Shown to the right of the title, e.g. an "Open register" link. */
  action?: ReactNode;
  /** "table": tight padding for a DataTable that runs edge to edge (Register). */
  padding?: "default" | "table";
  className?: string;
  children: ReactNode;
};

export function Card({ title, action, padding = "default", className, children }: CardProps) {
  const isTable = padding === "table";

  return (
    <section
      className={cx(
        "rounded-card border border-border bg-surface",
        isTable ? "px-2 pt-2 pb-4" : "p-5",
        className,
      )}
    >
      {title !== undefined && (
        <div
          className={cx(
            "flex flex-wrap items-center justify-between gap-3",
            isTable ? "mx-3 mt-3 mb-1" : action ? "mb-3" : "mb-4",
          )}
        >
          <h2 className="m-0 text-[17px] font-bold">{title}</h2>
          {action && <div className="text-sm">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
