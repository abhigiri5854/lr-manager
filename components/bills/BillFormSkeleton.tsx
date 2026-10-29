import { FieldSkeleton, Skeleton } from "@/components/ui/Skeleton";

/** Placeholder while a freight bill loads: header, the details card and the LR table. */
export function BillFormSkeleton() {
  const card = "rounded-card border border-border bg-surface p-5";
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading freight bill">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72" />
      </div>
      <div className={card}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, k) => (
            <FieldSkeleton key={k} />
          ))}
        </div>
      </div>
      <div className={card}>
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
