"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroups } from "@/lib/navigation";
import { can } from "@/lib/permissions";
import { useRole } from "./Permissions";

/** Sidebar links with the current route highlighted. Render inside <Suspense>. */
export function SidebarNav() {
  return <SidebarLinks pathname={usePathname()} />;
}

/** Plain links; with no pathname nothing is highlighted (used as the Suspense fallback). */
export function SidebarLinks({ pathname }: { pathname: string | null }) {
  const role = useRole();
  return navGroups.map((group) => (
    <div key={group.heading} className="flex flex-col gap-0.5">
      <div className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-navy-muted">
        {group.heading}
      </div>
      {group.items
        .filter((item) => !item.action || can(role, item.action))
        .map((item) => {
          const active = pathname !== null && item.isActive(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "block rounded-control bg-primary px-3 py-2.75 font-semibold text-white no-underline hover:text-white"
                  : "block rounded-control px-3 py-2.75 text-navy-text no-underline hover:text-navy-text"
              }
            >
              {item.label}
            </Link>
          );
        })}
    </div>
  ));
}
