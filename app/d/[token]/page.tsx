import { Suspense } from "react";
import { CompanyEntry } from "@/components/driver/CompanyEntry";

async function Entry({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CompanyEntry token={token} />;
}

export default function DriverTokenPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={null}>
      <Entry params={params} />
    </Suspense>
  );
}
