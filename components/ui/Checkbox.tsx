import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Checkbox with its label on one row; 20px box like the Settings watermark toggle. */
export function Checkbox({
  checked,
  onChange,
  className,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label
      className={cx(
        "flex min-h-control cursor-pointer items-center gap-2 text-sm font-medium",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0"
      />
      {children}
    </label>
  );
}
