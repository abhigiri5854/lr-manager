import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StatementLinkPanel } from "@/components/market-trucks/StatementLinkPanel";
import {
  parseProfileTab,
  ProfileTabNav,
  ProfileTable,
  SummaryCards,
} from "@/components/market-trucks/TruckPartyProfile";
import { truckPartyRoleLabel } from "@/components/market-trucks/labels";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getCompany } from "@/lib/data/companies";
import { NotFoundError } from "@/lib/data/errors";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { getTruckPartyProfile } from "@/lib/data/truck-party-profile";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Truck party" };

/** Per request: reads the URL, the active company and role. */
async function Profile({ params, searchParams }: PageProps<"/market-trucks/parties/[id]">) {
  const role = await getActiveRole();
  if (!can(role, "freight.view")) {
    return (
      <NoAccess
        title="Truck party"
        role={role}
        action="freight.view"
        back={{ href: "/", label: "Back to the dashboard" }}
      />
    );
  }
  const { id } = await params;
  const tab = parseProfileTab((await searchParams).tab);
  const companyId = await getActiveCompanyId();
  const [profile, company] = await Promise.all([
    getTruckPartyProfile(companyId, id).catch((e) => {
      if (e instanceof NotFoundError) return null;
      throw e;
    }),
    getCompany(companyId),
  ]);
  if (!profile || profile.party.cancelledAt) notFound();
  const { party } = profile;
  const hasBank = !!party.accountNo;
  const hasUpi = !!(party.upiId || party.upiQrUrl);

  return (
    <>
      <PageHeader
        title={party.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{truckPartyRoleLabel[party.role]}</span>
            <span>Mobile: {party.mobile ?? "—"}</span>
            <span>
              PAN: <span className="font-mono">{party.pan ?? "—"}</span>
            </span>
            {hasBank || hasUpi ? (
              <Chip tone="green">{[hasBank && "Bank", hasUpi && "UPI"].filter(Boolean).join(" · ")}</Chip>
            ) : (
              <Chip tone="amber">No bank / UPI</Chip>
            )}
          </span>
        }
        breadcrumb={[{ label: "Truck parties", href: "/market-trucks/parties" }, { label: party.name }]}
        breadcrumbPlacement="above"
      />
      <SummaryCards profile={profile} />
      <div className="mb-4">
        <Card>
          <StatementLinkPanel
            partyId={party.id}
            partyName={party.name}
            companyName={company?.name ?? ""}
            mobile={party.mobile}
            balancePaise={profile.balancePaise}
            canEdit={can(role, "master.edit")}
          />
        </Card>
      </div>
      <ProfileTabNav partyId={party.id} active={tab} />
      <ProfileTable profile={profile} tab={tab} />
    </>
  );
}

export default function TruckPartyProfilePage(props: PageProps<"/market-trucks/parties/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Profile {...props} />
    </Suspense>
  );
}
