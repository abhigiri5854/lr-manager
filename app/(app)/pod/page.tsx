import type { Metadata } from "next";
import Link from "next/link";
import { listPodPending } from "@/lib/data/pod";
import { formatDate, formatPaise } from "@/lib/format";

export const metadata: Metadata = { title: "POD pending" };

const columns = ["LR no", "Delivered on", "Consignee", "Days since delivery", "Penalty so far"];

// Table styles follow the th/td rules in design/screens/Register.dc.html.
const th =
  "border-b border-border px-3 py-2.5 text-left text-[13px] font-semibold whitespace-nowrap text-muted";
const td = "border-b border-border-row p-3 text-sm whitespace-nowrap";

export default async function PodPendingPage() {
  const rows = await listPodPending();

  return (
    <>
      <h1 className="m-0 text-[28px] font-bold">POD pending</h1>

      <section className="rounded-card border border-border bg-surface px-2 pt-2 pb-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} className={th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className={`${td} text-muted`}>
                    No LRs waiting for POD.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.lrId}>
                    <td className={td}>
                      <Link href={`/lr/${r.lrId}/pod`} className="font-mono">
                        {r.lrNo}
                      </Link>
                    </td>
                    <td className={td}>{formatDate(r.deliveredOn)}</td>
                    <td className={td}>{r.consignee}</td>
                    <td className={td}>{r.daysSinceDelivery}</td>
                    <td className={td}>₹{formatPaise(r.penaltyPaise)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
