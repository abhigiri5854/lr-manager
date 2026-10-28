import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

type CardProps = {
  title?: ReactNode;
  /** Small muted line under the title (Settings "LR terms"). */
  description?: ReactNode;
  /** Shown to the right of the title, e.g. an "Open register" link. */
  action?: ReactNode;
  /** "table": tight padding for a DataTable that runs edge to edge (Register). */
  padding?: "default" | "table";
  /** "large": 18px heading with a 12px gap below (Main.dc.html). Others use 17px. */
  heading?: "default" | "large";
  className?: string;
  children: ReactNode;
};

export function Card({
  title,
  description,
  action,
  padding = "default",
  heading = "default",
  className,
  children,
}: CardProps) {
  const isTable = padding === "table";
  const large = heading === "large";

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
            isTable ? "mx-3 mt-3 mb-1" : description ? "mb-1" : action || large ? "mb-3" : "mb-4",
          )}
        >
          <h2 className={cx("m-0 font-bold", large ? "text-[18px]" : "text-[17px]")}>{title}</h2>
          {action && <div className="text-sm">{action}</div>}
        </div>
      )}
      {description && <p className="mt-0 mb-4 text-[13px] text-muted">{description}</p>}
      {children}
    </section>
  );
}
