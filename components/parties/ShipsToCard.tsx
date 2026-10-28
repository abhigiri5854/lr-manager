import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { IfCan } from "@/components/ui/Permissions";
import type { ShipsTo } from "@/lib/data/parties";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function detail(r: ShipsTo) {
  return [
    r.billedToName && `Billed to ${r.billedToName}`,
    r.fromInvoiceScan && "Added from invoice scan",
    r.toPlace && `to ${r.toPlace}`,
    r.lrCount > 0 && plural(r.lrCount, "LR"),
    r.draftCount > 0 && plural(r.draftCount, "draft"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function ShipsToText({ r }: { r: ShipsTo }) {
  return (
    <>
      <b>{r.name}</b>
      {r.place && ` – ${r.place}`}
      <br />
      <span className="text-muted">{detail(r)}</span>
    </>
  );
}

/** Consignees this party has sent to; each starts a New LR with both parties filled. */
export function ShipsToCard({ consignorId, rows }: { consignorId: string; rows: ShipsTo[] }) {
  return (
    <Card className="min-w-0 flex-[1_1_360px]" title="Ships to (pick to start an LR)">
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-muted">No LRs from this party yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <IfCan
              key={r.consigneeId}
              action="lr.edit"
              fallback={
                <div className="rounded-control border border-border p-3 text-sm leading-normal">
                  <ShipsToText r={r} />
                </div>
              }
            >
              <Link
                href={`/lr/new?consignor=${consignorId}&consignee=${r.consigneeId}`}
                className="block rounded-control border border-border p-3 text-sm leading-normal text-text no-underline hover:bg-page hover:text-text"
              >
                <ShipsToText r={r} />
              </Link>
            </IfCan>
          ))}
        </div>
      )}
    </Card>
  );
}
