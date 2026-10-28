import type { Metadata } from "next";
import { LrForm } from "@/components/lr/LrForm";
import { getLrById, peekNextLrNo } from "@/lib/data/lrs";
import { getActiveCompanyId } from "@/lib/data/session";
import { todayInIndia } from "@/lib/fy";
import { emptyLrForm, lrToForm } from "@/lib/lr-form";
import { loadPicked } from "../load-form";

export const metadata: Metadata = { title: "New LR" };

/** New LR; `?from=<id>` copies that LR except its date, goods invoices and e-way bills. */
export default async function NewLrPage({ searchParams }: PageProps<"/lr/new">) {
  const { from } = await searchParams;
  const companyId = await getActiveCompanyId();
  const today = todayInIndia();
  const source = typeof from === "string" ? await getLrById(companyId, from) : null;
  const initial = source ? lrToForm(source, { copy: true, today }) : emptyLrForm(today);
  const [picked, nextLrNo] = await Promise.all([
    loadPicked(companyId, initial),
    peekNextLrNo(companyId, today),
  ]);

  return (
    <LrForm
      initial={initial}
      picked={picked}
      nextLrNo={nextLrNo}
      copiedFrom={source ? { lrNo: source.lrNo } : null}
    />
  );
}
