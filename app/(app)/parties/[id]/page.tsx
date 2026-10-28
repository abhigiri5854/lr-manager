import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CancelPartyButton } from "@/components/parties/CancelPartyButton";
import { PartyForm } from "@/components/parties/PartyForm";
import { PartyShipments } from "@/components/parties/PartyShipments";
import { PartyPageSkeleton } from "@/components/parties/PartyPageSkeleton";
import { ShipsToCard } from "@/components/parties/ShipsToCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { listTaxInvoices } from "@/lib/data/invoices";
import { listLrs } from "@/lib/data/lrs";
import {
  getPartyById,
  getPartyUsage,
  listShipsTo,
  partyBlockedReason,
  type PartyUsage,
} from "@/lib/data/parties";
import { getActiveCompanyId } from "@/lib/data/session";
import { partyLabel } from "@/lib/self-party";
import type { Party } from "@/lib/types";

export const metadata: Metadata = { title: "Party" };

/** "Consignor" / "Consignee" / "Billed-to party", whichever the party is most often. */
function roleLabel(u: PartyUsage): string {
  const roles = [
    { n: u.asConsignor, label: "Consignor" },
    { n: u.asConsignee, label: "Consignee" },
    { n: u.asBilledTo, label: "Billed-to party" },
  ].sort((a, b) => b.n - a.n);
  return roles[0].n > 0 ? roles[0].label : "Party";
}

async function PartyPageContent({ params }: Pick<PageProps<"/parties/[id]">, "params">) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const party = await getPartyById(companyId, id);
  if (!party || party.cancelledAt) notFound();

  const [usage, shipsTo, shipments, invoices] = await Promise.all([
    getPartyUsage(companyId, id),
    listShipsTo(companyId, id),
    listLrs(companyId, { partyId: id, pageSize: 50 }),
    listTaxInvoices(companyId, { partyId: id, pageSize: 50 }),
  ]);
  const self = party.isSelf;
  const title = self
    ? partyLabel(party)
    : party.place
      ? `${party.name} – ${party.place}`
      : party.name;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Parties", href: "/parties" }, { label: party.name }]}
        title={title}
        subtitle={
          <>
            {self ? "Our company" : roleLabel(usage)} ·{" "}
            {party.gstin ? <span className="font-mono">{party.gstin}</span> : "Unregistered"}
            {party.phone && <> · {party.phone}</>}
          </>
        }
        actions={
          <>
            {self ? (
              <Button variant="secondary" href="/settings/company">
                Edit in Company profile
              </Button>
            ) : (
              <Button variant="secondary" type="submit" form="party-form">
                Save changes
              </Button>
            )}
            <Button href={`/lr/new?consignor=${party.id}`}>New LR for this party</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-5">
        {self ? (
          <SelfDetails party={party} />
        ) : (
          <Card
            className="min-w-0 flex-[1_1_360px]"
            title={
              <>
                Saved details{" "}
                <span className="text-[13px] font-medium text-muted">
                  · edit &amp; Save — updates every new LR/invoice
                </span>
              </>
            }
          >
            <PartyForm key={party.version} mode="edit" party={party} />
          </Card>
        )}
        <ShipsToCard consignorId={party.id} rows={shipsTo} />
      </div>

      <PartyShipments partyId={party.id} lrs={shipments} invoices={invoices.rows} />

      {!self && (
        <Card title="Cancel party">
          <p className="m-0 mb-3 text-sm text-muted">
            Cancelled parties disappear from lists and pickers. Nothing is deleted.
          </p>
          <CancelPartyButton partyId={party.id} blockedBy={partyBlockedReason(usage)} />
        </Card>
      )}
    </>
  );
}

/** Our own company as a party: read-only, the Company profile is the source. */
function SelfDetails({ party }: { party: Party }) {
  const rows: Array<[string, string | null]> = [
    ["Name", party.name],
    ["GSTIN", party.gstin],
    ["PAN", party.pan],
    ["Phone", party.phone],
    ["Address", party.address],
    ["State code", party.stateCode],
    ["PIN code", party.pincode],
  ];
  return (
    <Card
      className="min-w-0 flex-[1_1_360px]"
      title={
        <>
          Our company{" "}
          <span className="text-[13px] font-medium text-muted">
            · details come from <Link href="/settings/company">Company profile</Link>
          </span>
        </>
      }
    >
      <p className="mt-0 mb-4 text-sm text-muted">
        Use it as consignor, consignee or billed-to on any LR. It can&apos;t be edited or cancelled
        here; change the Company profile and it updates automatically.
      </p>
      <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-label">{k}</dt>
            <dd className={k === "GSTIN" || k === "PAN" ? "m-0 font-mono" : "m-0"}>{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export default function PartyPage({ params }: PageProps<"/parties/[id]">) {
  return (
    <Suspense fallback={<PartyPageSkeleton />}>
      <PartyPageContent params={params} />
    </Suspense>
  );
}
