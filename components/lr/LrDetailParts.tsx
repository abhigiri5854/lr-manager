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

/** Bordered tile in "Linked documents". Without `href` it is a plain box (document not made yet). */
export function DocTile({
  href,
  newTab,
  title,
  note,
  children,
}: {
  href?: string;
  /** PDFs open outside the app, so a plain link in a new tab. */
  newTab?: boolean;
  title: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  const body = (
    <>
      <b>{title}</b>
      {note && <> · {note}</>}
      {children && (
        <>
          <br />
          <span className="text-muted">{children}</span>
        </>
      )}
    </>
  );
  const cls =
    "block rounded-control border border-border p-3 text-sm leading-normal text-text no-underline";
  if (!href) return <div className={cls}>{body}</div>;
  const linkCls = cx(cls, "hover:bg-page hover:text-text");
  return newTab ? (
    <a href={href} target="_blank" rel="noopener" className={linkCls}>
      {body}
    </a>
  ) : (
    <Link href={href} className={linkCls}>
      {body}
    </Link>
  );
}
