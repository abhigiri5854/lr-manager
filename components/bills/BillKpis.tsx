import Link from "next/link";
import { Kpi, KpiGrid } from "@/components/dashboard/KpiCards";
import { IfCan } from "@/components/ui/Permissions";
import type { BillsOverview } from "@/lib/data/bill-reports";
import { formatRupeesShort } from "@/lib/format";

/** The four tiles at the top of /bills (Bills.dc.html). */
export function BillKpis({ data }: { data: BillsOverview }) {
  const { ageing } = data;
  return (
    <KpiGrid>
      <Kpi
        label="Unbilled TBB LRs"
        value={data.unbilledTbbLrs}
        sub={
          <>
            {data.unbilledTbbLrs > 0 ? "Ready to bill" : "Nothing waiting"}
            <IfCan action="bill.edit">
              {data.unbilledTbbLrs > 0 && (
                <>
                  {" · "}
                  <Link href="/bills/new">Make freight bill</Link>
                </>
              )}
            </IfCan>
          </>
        }
      />
      <Kpi label="Bills raised" value={data.billsThisFy} sub="this financial year" />
      <Kpi
        label="Received"
        value={formatRupeesShort(data.receivedPaise)}
        sub="incl. TDS, this financial year"
      />
      <Kpi
        label="Outstanding"
        value={formatRupeesShort(data.outstandingPaise)}
        sub={`0–30: ${formatRupeesShort(ageing.d0to30)} · 31–60: ${formatRupeesShort(ageing.d31to60)} · 60+: ${formatRupeesShort(ageing.d60plus)}`}
      />
    </KpiGrid>
  );
}

export function BillKpisLoading() {
  const labels = ["Unbilled TBB LRs", "Bills raised", "Received", "Outstanding"];
  return (
    <KpiGrid>
      {labels.map((label) => (
        <Kpi key={label} label={label} value="…" sub="Loading…" />
      ))}
    </KpiGrid>
  );
}
