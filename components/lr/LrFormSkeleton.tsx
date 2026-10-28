import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { FieldSkeleton, Skeleton } from "@/components/ui/Skeleton";

const fields = (n: number) => Array.from({ length: n }, (_, i) => <FieldSkeleton key={i} />);

/** Loading state for New / Edit LR: same header, cards and grid as LrForm. */
export function LrFormSkeleton({ mode }: { mode: "new" | "edit" }) {
  return (
    <>
      <PageHeader
        breadcrumb={
          mode === "new"
            ? [{ label: "Dashboard", href: "/" }, { label: "New consignment note" }]
            : [{ label: "LR register", href: "/lr" }, { label: "Edit" }]
        }
        breadcrumbPlacement="inline"
        title={
          mode === "new" ? (
            <>
              New LR{" "}
              <span className="text-[13px] font-medium text-muted">(next — confirmed on save)</span>
            </>
          ) : (
            "Edit LR"
          )
        }
        actions={
          <>
            {mode === "new" && (
              <Button variant="secondary" disabled>
                Save draft
              </Button>
            )}
            <Button variant="secondary" href="#" disabled>
              Preview PDF
            </Button>
            <Button variant="dark" disabled>
              {mode === "new" ? "Save & book" : "Save"}
            </Button>
          </>
        }
      />
      <div role="status" className="flex flex-wrap items-start gap-5">
        <span className="sr-only">Loading the LR form…</span>
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-5">
          <Card title="Booking">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{fields(4)}</div>
          </Card>
          <Card title="Parties">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">{fields(4)}</div>
          </Card>
          <Card title="Vehicle & documents">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields(6)}</div>
          </Card>
          <Card title="Goods" className="[&>div:first-child]:mb-3">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-control w-full" />
              <Skeleton className="h-control w-full" />
            </div>
          </Card>
          <Card title="Freight & payment">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{fields(8)}</div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Skeleton className="h-control w-24" />
              <Skeleton className="h-control w-24" />
              <Skeleton className="h-control w-24" />
            </div>
          </Card>
        </div>
        <aside className="flex flex-[1_1_300px] flex-col gap-4">
          <Card title="Before you save" className="[&>div:first-child]:mb-2.5">
            <div className="flex flex-col gap-2.5">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
