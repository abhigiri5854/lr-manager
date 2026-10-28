import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoiceAlreadyOnLr } from "@/components/lr/InvoiceAlreadyOnLr";
import { LrForm } from "@/components/lr/LrForm";
import { LrFormSkeleton } from "@/components/lr/LrFormSkeleton";
import { getTaxInvoiceById } from "@/lib/data/invoices";
import {
  findLrsWithInvoice,
  getConsigneeToPlace,
  getConsignorDefaults,
  getLrById,
  peekNextLrNo,
} from "@/lib/data/lrs";
import { getActiveCompanyId } from "@/lib/data/session";
import { todayInIndia } from "@/lib/fy";
import { applyConsignorDefaults, emptyLrForm, invoiceToForm, lrToForm } from "@/lib/lr-form";
import { loadPicked } from "../load-form";

export const metadata: Metadata = { title: "New LR" };

type SearchParams = PageProps<"/lr/new">["searchParams"];

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Per request: reads the URL and the active company.
 * `?from=<lrId>` copies that LR except date, goods invoices and e-way bills.
 * `?invoice=<taxInvoiceId>` fills parties, goods, value and truck from that tax invoice. If the
 * invoice is already on an LR, it only warns until the user adds `&again=1` ("Create another").
 */
async function NewLr({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const companyId = await getActiveCompanyId();
  const today = todayInIndia();
  const [source, invoice] = await Promise.all([
    one(params.from) ? getLrById(companyId, one(params.from)!) : null,
    one(params.invoice) ? getTaxInvoiceById(companyId, one(params.invoice)!) : null,
  ]);

  if (invoice && params.again !== "1") {
    const onLrs = await findLrsWithInvoice(companyId, {
      taxInvoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
    });
    if (onLrs.length) {
      return (
        <InvoiceAlreadyOnLr
          invoiceNo={invoice.invoiceNo}
          lrs={onLrs}
          continueHref={`/lr/new?invoice=${encodeURIComponent(invoice.id)}&again=1`}
        />
      );
    }
  }

  let initial = invoice
    ? invoiceToForm(invoice, { today })
    : source
      ? lrToForm(source, { copy: true, today })
      : emptyLrForm(today);

  const [picked, nextLrNo, defaults, toPlace] = await Promise.all([
    loadPicked(companyId, initial),
    peekNextLrNo(companyId, today),
    // From an invoice, the parties are already known: fill their usual values too.
    invoice?.sellerPartyId ? getConsignorDefaults(companyId, invoice.sellerPartyId) : null,
    invoice ? getConsigneeToPlace(companyId, invoice.billToId) : null,
  ]);
  if (toPlace && !initial.toPlace) initial = { ...initial, toPlace };

  let initialDefaults = null;
  if (defaults && picked.consignor) {
    const { patch, fill } = applyConsignorDefaults(initial, defaults, picked.consignor.name);
    initial = { ...initial, ...patch };
    initialDefaults = fill;
  }

  return (
    <LrForm
      initial={initial}
      picked={picked}
      nextLrNo={nextLrNo}
      copiedFrom={source && !invoice ? { lrNo: source.lrNo } : null}
      linkedInvoice={invoice ? { id: invoice.id, invoiceNo: invoice.invoiceNo } : null}
      initialDefaults={initialDefaults}
      // The user already chose "Create another anyway" for this invoice.
      keptInvoiceNos={
        invoice && params.again === "1"
          ? { [initial.invoices[0].key]: invoice.invoiceNo }
          : undefined
      }
    />
  );
}

export default function NewLrPage({ searchParams }: PageProps<"/lr/new">) {
  return (
    <Suspense fallback={<LrFormSkeleton mode="new" />}>
      <NewLr searchParams={searchParams} />
    </Suspense>
  );
}
