import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * /lr/new?invoice= when that tax invoice is already on an LR: nothing is pre-filled until the
 * user picks one of the choices.
 */
export function InvoiceAlreadyOnLr({
  invoiceNo,
  lrs,
  continueHref,
}: {
  invoiceNo: string;
  /** Newest first. */
  lrs: { id: string; lrNo: string }[];
  /** Same URL with the "create another" confirmation. */
  continueHref: string;
}) {
  const first = lrs[0];
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Dashboard", href: "/" }, { label: "New consignment note" }]}
        breadcrumbPlacement="inline"
        title="New LR"
      />
      <div
        role="alert"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-tile border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
      >
        <b>
          Invoice {invoiceNo} is already on LR {lrs.map((l) => l.lrNo).join(", ")}
        </b>
        <span aria-hidden>·</span>
        <Link href={`/lr/${first.id}`} className="font-semibold">
          Open LR {first.lrNo}
        </Link>
        <span aria-hidden>·</span>
        <Link href={continueHref} className="font-semibold">
          Create another anyway
        </Link>
      </div>
    </>
  );
}
