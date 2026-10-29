import type { Metadata } from "next";
import { Suspense } from "react";
import { BillForm } from "@/components/bills/BillForm";
import { BillFormSkeleton } from "@/components/bills/BillFormSkeleton";
import { NoAccess } from "@/components/ui/NoAccess";
import type { BillFormValues } from "@/lib/bill-form";
import { getCompany } from "@/lib/data/companies";
import { listPartyOptions } from "@/lib/data/parties";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { todayInIndia } from "@/lib/fy";
import { can } from "@/lib/permissions";
import { loadBillParty } from "../load-form";

export const metadata: Metadata = { title: "New freight bill" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** `?party=<id>` starts the bill with that party and its unbilled LRs. */
async function NewFreightBill({ searchParams }: Pick<PageProps<"/bills/new">, "searchParams">) {
  const [params, role, companyId] = await Promise.all([
    searchParams,
    getActiveRole(),
    getActiveCompanyId(),
  ]);
  if (!can(role, "bill.edit")) {
    return (
      <NoAccess
        title="New freight bill"
        role={role}
        action="bill.edit"
        back={{ href: "/bills", label: "Open Bills & payments" }}
      />
    );
  }
  const [parties, company] = await Promise.all([listPartyOptions(companyId), getCompany(companyId)]);
  if (!company) return null;
  const partyId = parties.find((p) => p.id === one(params.party))?.id ?? "";
  const data = partyId ? await loadBillParty(companyId, partyId) : null;
  const initial: BillFormValues = {
    partyId,
    billDate: todayInIndia(),
    gstMode: "reverse_charge",
    from: "",
    to: "",
    lines: {},
  };
  return (
    <BillForm
      bill={null}
      initial={initial}
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

export default function NewFreightBillPage({ searchParams }: PageProps<"/bills/new">) {
  return (
    <Suspense fallback={<BillFormSkeleton />}>
      <NewFreightBill searchParams={searchParams} />
    </Suspense>
  );
}
