"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-control items-center justify-center rounded-control border border-border-input bg-surface px-4 font-semibold text-text print:hidden"
    >
      {label}
    </button>
  );
}
