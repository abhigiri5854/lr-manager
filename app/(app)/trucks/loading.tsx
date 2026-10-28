import { TrucksScreen } from "@/components/trucks/TrucksScreen";
import { PageHeader } from "@/components/ui/PageHeader";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Trucks & drivers"
        subtitle="Every truck typed in an LR, scanned from an invoice or imported from Excel lands here once — no duplicates."
      />
      <TrucksScreen query={{ tp: 1, dp: 1 }} today="1970-01-01" loading />
    </>
  );
}
