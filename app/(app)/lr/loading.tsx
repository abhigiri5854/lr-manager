import {
  ExportButtonLoading,
  RegisterHeader,
  RegisterSkeleton,
} from "@/components/lr/RegisterFrame";

export default function Loading() {
  return (
    <>
      <RegisterHeader exportButton={<ExportButtonLoading />} />
      <RegisterSkeleton />
    </>
  );
}
