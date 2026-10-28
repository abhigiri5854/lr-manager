import { Suspense } from "react";
import { listCompanies } from "@/lib/data/companies";
import { getActiveCompanyId } from "@/lib/data/session";
import { CompanySelect } from "./CompanySwitcher";
import { SidebarLinks, SidebarNav } from "./SidebarNav";

const selectClass =
  "mt-1 mb-2 h-control w-full rounded-control border border-navy-border bg-navy-raised px-2.5 text-sm font-semibold text-white";

/** Loads the user's companies per request (session-dependent). */
async function CompanySwitcher() {
  const [companies, activeId] = await Promise.all([listCompanies(), getActiveCompanyId()]);
  return (
    <CompanySelect
      companies={companies.map(({ id, label, city }) => ({ id, label, city }))}
      activeId={activeId}
      className={selectClass}
    />
  );
}

export function Sidebar() {
  return (
    <nav
      aria-label="Main"
      // 268px = the design's 240px content width + 14px padding each side.
      // When it sits beside the content (shell ≥ 892px, see app/(app)/layout.tsx)
      // it sticks to the viewport and scrolls on its own; stacked, it scrolls with the page.
      className="flex flex-[1_1_268px] flex-col gap-0.5 bg-navy px-3.5 py-5 *:shrink-0 @min-[892px]:sticky @min-[892px]:top-0 @min-[892px]:h-screen @min-[892px]:[scrollbar-width:thin] @min-[892px]:[scrollbar-color:var(--color-navy-border)_transparent] @min-[892px]:overflow-y-auto"
    >
      <div className="px-2.5 pb-3 text-[18px] font-bold text-white">
        LR <span className="font-medium text-navy-muted">Manager</span>
      </div>

      <label htmlFor="nav-co" className="m-0 block px-2.5 text-xs font-semibold text-navy-muted">
        Working as
      </label>
      <Suspense
        fallback={
          <select id="nav-co" disabled className={selectClass}>
            <option>Loading…</option>
          </select>
        }
      >
        <CompanySwitcher />
      </Suspense>

      <label htmlFor="nav-q" className="sr-only">
        Search everything
      </label>
      <input
        id="nav-q"
        type="search"
        placeholder="Search LR, invoice, truck, party…"
        className="mb-1.5 h-control w-full rounded-control border border-navy-border bg-surface px-3 text-sm text-text"
      />

      <Suspense fallback={<SidebarLinks pathname={null} />}>
        <SidebarNav />
      </Suspense>
    </nav>
  );
}
