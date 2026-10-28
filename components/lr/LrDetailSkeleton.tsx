import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

/** Placeholder while the LR loads: header, six timeline tiles, three cards. */
export function LrDetailSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[62px] min-w-[140px] flex-[1_1_140px] rounded-tile" />
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-5">
        {["flex-[1_1_380px]", "flex-[1_1_380px]", "flex-[1_1_300px]"].map((basis, i) => (
          <Card key={i} className={`min-w-0 ${basis}`}>
            <div className="flex flex-col gap-3">
              {Array.from({ length: 7 }, (_, j) => (
                <Skeleton key={j} className="h-5 w-full" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
