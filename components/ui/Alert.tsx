import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

type AlertProps = {
  tone: "info" | "warning";
  title?: ReactNode;
  /** Optional button or link on the right (info) or below (warning). */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
};

/**
 * info    — blue banner from Import / Invoice ("Read by AI from …").
 * warning — amber box from NewLR / POD ("E-way bill · not generated").
 */
export function Alert({ tone, title, action, className, children }: AlertProps) {
  if (tone === "info") {
    return (
      <div
        role="status"
        className={cx(
          "flex flex-wrap items-center gap-3 rounded-tile bg-primary-soft px-4 py-3 text-sm text-primary",
          className,
        )}
      >
        {title && <b>{title}</b>}
        {children && <span className="text-text-strong">{children}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
    );
  }

  return (
    <div
      className={cx(
        "rounded-control border border-warning-border bg-warning-soft p-3 text-sm text-warning",
        className,
      )}
    >
      {title && <b>{title}</b>}
      {title && children && " "}
      {children}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
