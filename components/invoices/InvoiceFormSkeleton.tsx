import { FieldSkeleton, Skeleton } from "@/components/ui/Skeleton";

/** Placeholder while an invoice loads: header, three field cards and the items card. */
export function InvoiceFormSkeleton() {
  const card = "rounded-card border border-border bg-surface p-5";
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading invoice">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72" />
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_680px] flex-col gap-5">
          {[8, 2, 6].map((n, i) => (
            <div key={i} className={card}>
              <Skeleton className="mb-4 h-5 w-40" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: n }, (_, k) => (
                  <FieldSkeleton key={k} />
                ))}
              </div>
            </div>
          ))}
          <div className={card}>
            <Skeleton className="mb-4 h-5 w-24" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <Skeleton className="h-48 w-full rounded-card" />
          <Skeleton className="h-32 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
