import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { FieldSkeleton, Skeleton } from "@/components/ui/Skeleton";

/** Loading state for the POD screen: same header and cards as PodForm. */
export function PodSkeleton() {
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "← LR", href: "/lr" }]}
        title="POD"
        actions={
          <>
            <Button variant="secondary" disabled>
              Save changes
            </Button>
            <Button variant="secondary" href="#" disabled>
              Preview PDF
            </Button>
            <Button variant="dark" href="#" disabled>
              Download PDF
            </Button>
          </>
        }
      />
      <div role="status" className="flex flex-wrap items-start gap-5">
        <span className="sr-only">Loading the POD form…</span>
        <div className="min-w-0 flex-[999_1_640px]">
          <Card title="Delivery details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <FieldSkeleton key={i} />
              ))}
            </div>
            <Skeleton className="mt-4 h-28 w-full" />
          </Card>
        </div>
        <div className="min-w-0 flex-[1_1_300px]">
          <Card title="Documents">
            <Skeleton className="h-16 w-full" />
          </Card>
        </div>
      </div>
    </>
  );
}
