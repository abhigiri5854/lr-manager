import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export type ChipTone = "blue" | "amber" | "green" | "grey" | "red";

const tones: Record<ChipTone, string> = {
  blue: "bg-primary-soft text-primary",
  amber: "bg-warning-soft text-warning",
  green: "bg-success-soft text-success",
  grey: "bg-surface-muted text-label",
  red: "bg-danger-soft text-danger",
};

/** Status pill: 12px semibold, 4px × 10px padding, fully rounded. */
export function Chip({
  tone = "grey",
  children,
  className,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-chip px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
