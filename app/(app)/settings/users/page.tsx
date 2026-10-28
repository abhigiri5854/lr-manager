import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { UsersScreen } from "@/components/users/UsersScreen";
import { getCompany } from "@/lib/data/companies";
import { listMemberRows } from "@/lib/data/members";
import { getActiveCompanyId } from "@/lib/data/session";
import { PERMISSION_ROWS, permissionCell, ROLE_LABEL, ROLES } from "@/lib/permissions";

export const metadata: Metadata = { title: "Users & roles" };

const th =
  "border-b border-border px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap text-muted";
const td = "border-b border-border-row p-3 text-sm whitespace-nowrap";

/** "What each role can do", generated from lib/permissions.ts. */
function PermissionTable() {
  return (
    <Card title="What each role can do" className="[&_h2]:mb-0">
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} text-left`}>Permission</th>
              {ROLES.map((r) => (
                <th key={r} className={`${th} text-center`}>
                  {ROLE_LABEL[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_ROWS.map((row) => (
              <tr key={row.action}>
                <th scope="row" className={`${td} text-left font-normal`}>
                  {row.label}
                </th>
                {ROLES.map((r) => {
                  const cell = permissionCell(r, row);
                  return (
                    <td key={r} className={`${td} text-center`}>
                      {cell === "—" ? <span aria-label="No">—</span> : cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 mb-0 text-[13px] text-muted">
        Drivers only see the phone app (<Link href="/driver">My trips</Link>). Every action is
        written to the activity log with the user’s name.
      </p>
    </Card>
  );
}

async function Users() {
  const companyId = await getActiveCompanyId();
  const [rows, company] = await Promise.all([listMemberRows(companyId), getCompany(companyId)]);
  return (
    <UsersScreen
      key={companyId}
      rows={rows}
      companyLabel={company?.label ?? ""}
      permissionTable={<PermissionTable />}
    />
  );
}

export default function UsersPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader
            eyebrow="SETTINGS"
            title="Users & roles"
            subtitle="Who can log in, for which company, and what they can do."
          />
          <Skeleton className="h-60 rounded-card" />
          <Skeleton className="h-96 rounded-card" />
        </>
      }
    >
      <Users />
    </Suspense>
  );
}
