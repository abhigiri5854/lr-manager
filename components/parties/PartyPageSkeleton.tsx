import { Card } from "@/components/ui/Card";
import { FieldSkeleton, Skeleton } from "@/components/ui/Skeleton";

/** Loading state for /parties/[id]: header bar plus the details card. */
export function PartyPageSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-9 w-80 max-w-full" />
      <div className="flex flex-wrap gap-5">
        <Card className="min-w-0 flex-[1_1_360px]">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <FieldSkeleton key={i} className="col-span-2 sm:col-span-1" />
            ))}
          </div>
        </Card>
        <Card className="min-w-0 flex-[1_1_360px]">
          <Skeleton className="h-20 w-full" />
        </Card>
      </div>
    </>
  );
}
