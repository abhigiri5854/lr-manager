"use client";

import { Button } from "@/components/ui/Button";

export default function MarketTrucksError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-8">
      <h2 className="m-0 text-lg font-semibold">Something went wrong</h2>
      <p className="m-0 text-sm text-muted">This page couldn&apos;t load. Please try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
