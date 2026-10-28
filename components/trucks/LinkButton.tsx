import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

/** A button that looks like the design's "Edit" link, for actions that open a dialog or call the server. */
export function LinkButton({
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-primary hover:text-primary-hover hover:underline disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}
