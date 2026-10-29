import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BillForm } from "@/components/bills/BillForm";
import { BillFormSkeleton } from "@/components/bills/BillFormSkeleton";
import { NoAccess } from "@/components/ui/NoAccess";
import { billToFormValues } from "@/lib/bill-form";
import { getFreightBillById } from "@/lib/data/bills";
import { getCompany } from "@/lib/data/companies";
import { listPartyOptions } from "@/lib/data/parties";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { can } from "@/lib/permissions";
import { loadBillParty } from "../load-form";

export const metadata: Metadata = { title: "Freight bill" };

async function BillLoader({ params }: Pick<PageProps<"/bills/[id]">, "params">) {
  const [{ id }, companyId, role] = await Promise.all([
    params,
    getActiveCompanyId(),
    getActiveRole(),
  ]);
  if (!can(role, "freight.view")) {
    return (
      <NoAccess
        title="Freight bill"
        role={role}
        action="freight.view"
        back={{ href: "/", label: "Open Dashboard" }}
      />
    );
  }
  const bill = await getFreightBillById(companyId, id);
  if (!bill) notFound();
  const [parties, company, data] = await Promise.all([
    listPartyOptions(companyId),
    getCompany(companyId),
    loadBillParty(companyId, bill.partyId, bill),
  ]);
  if (!company) return null;
  return (
    <BillForm
      // A save bumps the version; remounting picks up the saved values.
      key={`${bill.id}:${bill.version}`}
      bill={bill}
      initial={billToFormValues(bill)}
      data={data}
      parties={parties}
      company={{
        label: company.label,
        freightBillPrefix: company.freightBillPrefix,
        freightGstRateBp: company.freightGstRateBp,
      }}
    />
  );
}

export default function BillPage({ params }: PageProps<"/bills/[id]">) {
  return (
    <Suspense fallback={<BillFormSkeleton />}>
      <BillLoader params={params} />
    </Suspense>
  );
}
