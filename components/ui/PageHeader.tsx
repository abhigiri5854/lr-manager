import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { cx } from "@/lib/cx";

export type Crumb = { label: ReactNode; href?: string };

type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small blue uppercase label above the title (Settings, Import). */
  eyebrow?: ReactNode;
  /** "Dashboard / New consignment note", or a single back link like "← LR 19019". */
  breadcrumb?: Crumb[];
  /**
   * "above" (LRView, POD, Parties): breadcrumb sits on its own line, spaced by the page gap.
   * "inline" (NewLR, Invoice): breadcrumb sits 4px above the title.
   */
  breadcrumbPlacement?: "above" | "inline";
  /** Buttons on the right; wrap below the title on narrow screens. */
  actions?: ReactNode;
};

function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && " / "}
          {item.href ? <Link href={item.href}>{item.label}</Link> : item.label}
        </Fragment>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  breadcrumb,
  breadcrumbPlacement = "above",
  actions,
}: PageHeaderProps) {
  const inlineCrumb = breadcrumb && breadcrumbPlacement === "inline";
  const hasLabelAbove = inlineCrumb || eyebrow;

  return (
    <>
      {breadcrumb && !inlineCrumb && <Breadcrumb items={breadcrumb} />}
      <div
        className={cx(
          "flex flex-wrap justify-between gap-4",
          eyebrow ? "items-end" : "items-center",
        )}
      >
        <div className="min-w-0">
          {inlineCrumb && <Breadcrumb items={breadcrumb} />}
          {eyebrow && (
            <div className="text-xs font-semibold tracking-[0.08em] text-primary">{eyebrow}</div>
          )}
          <h1 className={cx("text-[28px] font-bold", hasLabelAbove ? "mt-1 mb-0" : "m-0")}>
            {title}
          </h1>
          {subtitle && <p className="mt-1 mb-0 max-w-[720px] text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
      </div>
    </>
  );
}
