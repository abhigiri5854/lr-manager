import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";

export type ButtonVariant = "primary" | "secondary" | "outline" | "dark" | "danger";

// From the design files: 44px tall, 8px radius, semibold.
// Filled buttons use 18px side padding, bordered ones 16px.
const base =
  "inline-flex h-control items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap no-underline disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "border-0 bg-primary px-4.5 text-white hover:bg-primary-hover hover:text-white",
  secondary: "border border-border-input bg-surface px-4 text-text hover:bg-page hover:text-text",
  // "Smart import" on the dashboard
  outline:
    "border border-primary bg-surface px-4 text-primary hover:bg-primary-soft hover:text-primary",
  dark: "border-0 bg-navy px-4.5 text-white hover:bg-navy-raised hover:text-white",
  // Destructive confirm, e.g. "Cancel LR"
  danger: "border-0 bg-danger px-4.5 text-white hover:opacity-90 hover:text-white",
};

type CommonProps = {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { href?: undefined };

type ButtonAsLink = CommonProps & {
  href: string;
  /** Renders a non-clickable link (links can't be `disabled`). */
  disabled?: boolean;
  /** File download (e.g. Excel export): a plain <a download>, not a client-side route change. */
  download?: boolean;
  /** Opens in a new tab (e.g. PDF preview): a plain <a target="_blank">. */
  newTab?: boolean;
};

export function Button(props: ButtonAsButton | ButtonAsLink) {
  if (props.href !== undefined) {
    const { variant = "primary", className, children, href, disabled, download, newTab } = props;
    if (download || newTab) {
      return (
        <a
          href={disabled ? undefined : href}
          download={download || undefined}
          target={newTab ? "_blank" : undefined}
          rel={newTab ? "noopener" : undefined}
          className={cx(base, variants[variant], className)}
          aria-disabled={disabled || undefined}
        >
          {children}
        </a>
      );
    }
    return (
      <Link
        href={href}
        className={cx(base, variants[variant], className)}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
      >
        {children}
      </Link>
    );
  }

  const { variant = "primary", className, children, type = "button", ...rest } = props;
  return (
    <button type={type} className={cx(base, variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}
