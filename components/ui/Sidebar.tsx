import { Suspense } from "react";
import { getCompany } from "@/lib/data/companies";
import { getActiveCompanyId, getCurrentUser, getRole } from "@/lib/data/session";
import { ROLE_LABEL } from "@/lib/permissions";
import { SidebarLinks, SidebarNav } from "./SidebarNav";

/** The company this login belongs to, and "Switch company" (logs out; no switching without a login). */
async function WorkingAs() {
  const company = await getCompany(await getActiveCompanyId());
  return (
    <div className="mt-1 mb-2 px-2.5" id="nav-co">
      <div className="text-[15px] font-semibold break-words text-white">{company?.label ?? ""}</div>
      {company?.city && <div className="text-xs text-navy-muted">{company.city}</div>}
      {/* Plain POST to app/logout/route.ts, then /login opens with an empty company code. */}
      <form action="/logout" method="post" className="mt-2.5">
        <button
          type="submit"
          className="flex h-[34px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-control border border-navy-border bg-transparent text-xs font-semibold text-navy-text hover:bg-navy-raised"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Switch company
        </button>
      </form>
    </div>
  );
}

/** Who is signed in, their role here, and Log out (bottom of the sidebar). */
async function SidebarUser() {
  const user = await getCurrentUser();
  const role = await getRole(await getActiveCompanyId());
  return (
    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-navy-border px-2.5 pt-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white">{user.name}</div>
        {role && <div className="text-xs text-navy-muted">{ROLE_LABEL[role]}</div>}
      </div>
      {/* Plain POST to app/logout/route.ts: a full reload clears the client cache. */}
      <form action="/logout" method="post">
        <button
          type="submit"
          className="h-control cursor-pointer rounded-control border border-navy-border bg-transparent px-3 text-sm font-semibold text-navy-text hover:bg-navy-raised hover:text-white"
        >
          Log out
        </button>
      </form>
    </div>
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

      <div className="m-0 block px-2.5 text-[11px] font-semibold tracking-[0.06em] text-navy-muted uppercase">
        Working as
      </div>
      <Suspense fallback={<div className="mt-1 mb-2 h-5 px-2.5 text-sm text-navy-muted">Loading…</div>}>
        <WorkingAs />
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

      <div className="h-6" aria-hidden />
      <Suspense>
        <SidebarUser />
      </Suspense>
    </nav>
  );
}
