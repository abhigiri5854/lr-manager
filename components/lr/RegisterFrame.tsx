import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegisterFilters } from "./RegisterFilters";
import { RegisterTable } from "./RegisterTable";

const FOOTNOTE =
  "Click any row to open the LR; Print gives the Consignor / Consignee / Driver / Office copies as one PDF.";

export function RegisterTableCard({ children }: { children: ReactNode }) {
  return (
    <Card padding="table">
      {children}
      <p className="mx-3 mt-4 mb-0 text-[13px] text-muted">{FOOTNOTE}</p>
    </Card>
  );
}

/** Export Excel while the filters are still loading. */
export function ExportButtonLoading() {
  return (
    <Button variant="secondary" href="/lr/export" download disabled>
      Export Excel
    </Button>
  );
}

/** Static header; `exportButton` is the per-request one, or the disabled placeholder. */
export function RegisterHeader({ exportButton }: { exportButton: ReactNode }) {
  return (
    <PageHeader
      title="LR register"
      actions={
        <>
          {exportButton}
          <Button href="/lr/new">+ New LR</Button>
        </>
      }
    />
  );
}

/** Loading state for filters + table. */
export function RegisterSkeleton() {
  return (
    <>
      <RegisterFilters query={{}} parties={[]} trucks={[]} disabled />
      <RegisterTableCard>
        <RegisterTable lrs={[]} nowMs={0} empty="Loading…" />
      </RegisterTableCard>
    </>
  );
}
