import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ExportButtonLoading,
  RegisterHeader,
  RegisterSkeleton,
  RegisterTableCard,
} from "@/components/lr/RegisterFrame";
import { RegisterFilters } from "@/components/lr/RegisterFilters";
import { RegisterTable } from "@/components/lr/RegisterTable";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { listLrs } from "@/lib/data/lrs";
import { listPartyOptions } from "@/lib/data/parties";
import { getActiveCompanyId } from "@/lib/data/session";
import { listTruckOptions } from "@/lib/data/trucks";
import {
  hasLrFilters,
  lrRegisterSearch,
  parseLrRegisterQuery,
  toLrListParams,
} from "@/lib/validators/lr-register";
import { IfCan } from "@/components/ui/Permissions";

export const metadata: Metadata = { title: "LR register" };

type SearchParams = PageProps<"/lr">["searchParams"];

/** Exports the rows matching the current filters (all pages). */
async function ExportButton({ searchParams }: { searchParams: SearchParams }) {
  const query = parseLrRegisterQuery(await searchParams);
  return (
    <Button
      variant="secondary"
      href={`/lr/export${lrRegisterSearch({ ...query, page: 1 })}`}
      download
    >
      Export Excel
    </Button>
  );
}

/** Everything the register needs for this request. */
async function loadRegister(searchParams: SearchParams) {
  const query = parseLrRegisterQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const [page, parties, trucks] = await Promise.all([
    listLrs(companyId, toLrListParams(query)),
    listPartyOptions(companyId),
    listTruckOptions(companyId),
  ]);
  // E-way expiry colours are relative to now.
  return { query, page, parties, trucks, nowMs: Date.now() };
}

/** Filters + table; per request (reads the URL and the active company). */
async function Register({ searchParams }: { searchParams: SearchParams }) {
  const { query, page, parties, trucks, nowMs } = await loadRegister(searchParams);
  const filtered = hasLrFilters(query);

  const empty =
    page.total > 0 ? (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`/lr${lrRegisterSearch({ ...query, page: 1 })}`}>Go to page 1</Link>
      </>
    ) : filtered ? (
      <>
        No LRs match these filters. <Link href="/lr">Clear filters</Link>
      </>
    ) : (
      <>
        No consignment notes yet.
        <IfCan action="lr.edit">
          {" "}
          <Link href="/lr/new">Create the first LR</Link> or{" "}
          <Link href="/import">import a booking report</Link>.
        </IfCan>
      </>
    );

  return (
    <>
      <RegisterFilters query={query} parties={parties} trucks={trucks} />
      <RegisterTableCard>
        <RegisterTable lrs={page.rows} nowMs={nowMs} empty={empty} />
        <div className="mx-3 mt-4">
          <Pagination
            page={page.page}
            pageSize={page.pageSize}
            total={page.total}
            noun={page.total === 1 ? "LR" : "LRs"}
            hrefFor={(p) => `/lr${lrRegisterSearch({ ...query, page: p })}`}
          />
        </div>
      </RegisterTableCard>
    </>
  );
}

export default function LrRegisterPage({ searchParams }: PageProps<"/lr">) {
  return (
    <>
      <RegisterHeader
        exportButton={
          <Suspense fallback={<ExportButtonLoading />}>
            <ExportButton searchParams={searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<RegisterSkeleton />}>
        <Register searchParams={searchParams} />
      </Suspense>
    </>
  );
}
