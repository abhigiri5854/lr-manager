import { cx } from "@/lib/cx";

/** Grey placeholder block shown while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cx("animate-pulse rounded-control bg-surface-muted", className)} />
  );
}

/** Placeholder for a labelled form control (label bar + 44px control). */
export function FieldSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cx("min-w-0", className)}>
      <Skeleton className="mb-1.5 h-4 w-24" />
      <Skeleton className="h-control w-full" />
    </div>
  );
}
