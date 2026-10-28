import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoiceNumberingCard } from "@/components/settings/InvoiceNumberingCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getCompany } from "@/lib/data/companies";
import { peekNextInvoiceNo } from "@/lib/data/invoices";
import { getActiveCompanyId } from "@/lib/data/session";
import { todayInIndia } from "@/lib/fy";

export const metadata: Metadata = { title: "Company profile" };

// Only tax-invoice numbering is built so far; the rest of Settings.dc.html comes later.
async function CompanySettings() {
  const companyId = await getActiveCompanyId();
  const [company, next] = await Promise.all([
    getCompany(companyId),
    peekNextInvoiceNo(companyId, todayInIndia()),
  ]);
  if (!company) return null;
  return (
    <InvoiceNumberingCard
      key={`${company.id}:${company.version}`}
      version={company.version}
      prefix={company.taxInvoicePrefix}
      roundOff={company.invoiceRoundOff}
      nextCounter={next.counter}
      fy={next.fy}
    />
  );
}

export default function CompanyProfilePage() {
  return (
    <>
      <PageHeader
        title="Company profile"
        subtitle="Tax invoice numbering. Name, address, bank, logo and LR terms come in a later update."
      />
      <Suspense fallback={<Skeleton className="h-64 max-w-[720px] rounded-card" />}>
        <CompanySettings />
      </Suspense>
    </>
  );
}
