import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Label on the left, value on the right ("Consignor … Ashirvad Pipes"). */
export function DetailRow({
  label,
  children,
  mono,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-border-row py-2 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <b className={cx("min-w-0 text-right wrap-break-word", mono && "font-mono font-medium")}>
        {children}
      </b>
    </div>
  );
}

/**
 * Bordered tile in "Linked documents". With `href` the whole tile opens it (the title is a
 * stretched link, so `action` can hold its own link); without, the document doesn't exist yet.
 */
export function DocTile({
  href,
  newTab,
  title,
  note,
  action,
  children,
}: {
  href?: string;
  /** PDFs open outside the app, so a plain link in a new tab. */
  newTab?: boolean;
  title: ReactNode;
  note?: ReactNode;
  /** A link inside the tile, e.g. "Attach". */
  action?: ReactNode;
  children?: ReactNode;
}) {
  const stretch = "text-text no-underline after:absolute after:inset-0 hover:text-text";
  const heading = href ? (
    newTab ? (
      <a href={href} target="_blank" rel="noopener" className={stretch}>
        <b>{title}</b>
      </a>
    ) : (
      <Link href={href} className={stretch}>
        <b>{title}</b>
      </Link>
    )
  ) : (
    <b>{title}</b>
  );
  return (
    <div
      className={cx(
        "relative rounded-control border border-border p-3 text-sm leading-normal",
        href && "hover:bg-page",
      )}
    >
      {heading}
      {note && <> · {note}</>}
      {(children || action) && (
        <>
          <br />
          <span className="text-muted">
            {children}
            {action && (
              <>
                {" · "}
                <span className="relative z-10">{action}</span>
              </>
            )}
          </span>
        </>
      )}
    </div>
  );
}
