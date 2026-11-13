"use client";

import { useEffect, useState } from "react";

const KEY = "lrm-stale-action-reload";

/**
 * After a deploy, open tabs call Server Actions that no longer exist. Reload once to pick up the
 * new build. Returns true while reloading. The sessionStorage flag stops reload loops.
 */
export function useStaleActionReload(error: Error): boolean {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!error?.message?.includes("Failed to find Server Action")) return;
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, "1");
    } catch {
      return; // no storage: can't guard against a loop, so don't reload
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage can only be read after mount
    setReloading(true);
    window.location.reload();
  }, [error]);

  return reloading;
}
