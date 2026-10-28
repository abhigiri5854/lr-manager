import { Button } from "./Button";

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  /** Link for a page number, keeping the list's filters. */
  hrefFor: (page: number) => string;
  /** Plural noun for the count, e.g. "LRs". */
  noun: string;
};

const count = new Intl.NumberFormat("en-IN");

/** "Showing 51–100 of 1,234 LRs" with Previous / Next. Hides the buttons when it all fits on one page. */
export function Pagination({ page, pageSize, total, hrefFor, noun }: PaginationProps) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const pastEnd = first > total;

  return (
    <nav
      aria-label="Pages"
      className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted"
    >
      <p className="m-0" aria-live="polite">
        {pastEnd
          ? `${count.format(total)} ${noun}`
          : `Showing ${count.format(first)}–${count.format(last)} of ${count.format(total)} ${noun}`}
      </p>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Page {count.format(Math.min(page, pages))} of {count.format(pages)}
          </span>
          <Button variant="secondary" href={hrefFor(page - 1)} disabled={page <= 1}>
            ← Previous
          </Button>
          <Button variant="secondary" href={hrefFor(page + 1)} disabled={page >= pages}>
            Next →
          </Button>
        </div>
      )}
    </nav>
  );
}
