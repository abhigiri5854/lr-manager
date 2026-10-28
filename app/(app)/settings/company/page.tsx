import type { Metadata } from "next";
import { Suspense } from "react";
import { CompanyProfileForm } from "@/components/settings/CompanyProfileForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getCompany, getNumbering } from "@/lib/data/companies";
import { getActiveCompanyId, getRole } from "@/lib/data/session";
import { formatDate } from "@/lib/format";
import { todayInIndia } from "@/lib/fy";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Company profile" };

async function CompanyProfile() {
  const companyId = await getActiveCompanyId();
  const [company, numbering, role] = await Promise.all([
    getCompany(companyId),
    getNumbering(companyId),
    getRole(companyId),
  ]);
  if (!company) return null;
  return (
    <CompanyProfileForm
      // A new form when "Working as" changes; saves keep the same form (version is tracked inside).
      key={company.id}
      company={company}
      numbering={numbering}
      canEdit={can(role, "company.manage")}
      today={formatDate(todayInIndia())}
    />
  );
}

function ProfileSkeleton() {
  return (
    <>
      <PageHeader eyebrow="SETTINGS" title="Company profile" />
      <Skeleton className="h-16 rounded-tile" />
      <div className="flex flex-wrap items-start gap-5">
        <Skeleton className="h-[640px] min-w-0 flex-[999_1_560px] rounded-card" />
        <Skeleton className="h-[420px] min-w-0 flex-[1_1_380px] rounded-card" />
      </div>
    </>
  );
}

export default function CompanyProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <CompanyProfile />
    </Suspense>
  );
}
