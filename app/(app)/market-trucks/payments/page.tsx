import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentRegister, PaymentRegisterSkeleton } from "@/components/market-trucks/PaymentRegister";
import { Button } from "@/components/ui/Button";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { listTruckPaymentRows } from "@/lib/data/truck-payments";
import { todayInIndia } from "@/lib/fy";
import { can } from "@/lib/permissions";
import { parseTruckPaymentListQuery } from "@/lib/validators/truck-payment-list";

export const metadata: Metadata = { title: "Truck payments" };

/** Per request: reads the URL, the active company and role. */
async function Loader({ searchParams }: Pick<PageProps<"/market-trucks/payments">, "searchParams">) {
  const role = await getActiveRole();
  if (!can(role, "freight.view")) {
    return (
      <NoAccess
        title="Truck payments"
        role={role}
        action="freight.view"
        back={{ href: "/", label: "Back to the dashboard" }}
      />
    );
  }
  const query = parseTruckPaymentListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const page = await listTruckPaymentRows(companyId, { ...query, pageSize: 50 });
  return (
    <>
      <PageHeader
        title="Truck payments"
        subtitle="Advance and balance payments to truck owners and brokers. Recording a payment is optional."
        actions={can(role, "bill.edit") && <Button href="/market-trucks/payments/new">+ New payment</Button>}
      />
      <PaymentRegister query={query} page={page} today={todayInIndia()} />
    </>
  );
}

export default function PaymentsPage({ searchParams }: PageProps<"/market-trucks/payments">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Truck payments" />
          <PaymentRegisterSkeleton />
        </>
      }
    >
      <Loader searchParams={searchParams} />
    </Suspense>
  );
}
