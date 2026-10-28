"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { switchCompanyAction } from "@/app/(app)/session-actions";

/** "Working as" select. Switching re-renders every page for the chosen company. */
export function CompanySelect({
  companies,
  activeId,
  className,
}: {
  companies: { id: string; label: string; city: string }[];
  activeId: string;
  className: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      id="nav-co"
      value={activeId}
      disabled={pending}
      aria-busy={pending || undefined}
      onChange={(e) => {
        const id = e.target.value;
        startTransition(async () => {
          await switchCompanyAction(id);
          // Record pages (an LR, a party…) belong to the old company; go to its list instead.
          const list = pathname.match(/^\/(lr|invoices|parties|bills)\/[^/]+/)?.[1];
          if (list && !pathname.endsWith("/new")) router.push(`/${list}`);
        });
      }}
      className={className}
    >
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {`${c.label} · ${c.city}`}
        </option>
      ))}
    </select>
  );
}
