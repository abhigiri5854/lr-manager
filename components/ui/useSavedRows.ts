"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Versioned = { id: string; version: number };

/**
 * After a save, the action hands back the saved record (it doesn't re-render the page). This
 * shows it in the list straight away; a newer copy from the server (a later page load or
 * `refreshInBackground`) wins.
 */
export function useSavedRows<T extends Versioned>(rows: T[]) {
  const router = useRouter();
  const [saved, setSaved] = useState<Record<string, Partial<T> & Versioned>>({});
  const merged = rows.map((r) => {
    const s = saved[r.id];
    return s && s.version > r.version ? { ...r, ...s } : r;
  });
  return {
    rows: merged,
    /** Show this saved record in place of its row. */
    remember: (record: Partial<T> & Versioned) => setSaved((all) => ({ ...all, [record.id]: record })),
    /** Re-reads the page after the user already sees the save (other rows/totals may change). */
    refreshInBackground: () => router.refresh(),
  };
}
