import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { NoAccess } from "@/components/ui/NoAccess";
import { getActiveRole } from "@/lib/data/session";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "New freight bill" };

async function NewFreightBill() {
  const role = await getActiveRole();
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
  return <PlaceholderPage title="New freight bill" />;
}

export default function NewFreightBillPage() {
  return (
    <Suspense>
      <NewFreightBill />
    </Suspense>
  );
}
