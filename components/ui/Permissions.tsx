"use client";

import { createContext, useContext, type ReactNode } from "react";
import { can, type Action } from "@/lib/permissions";
import type { Role } from "@/lib/types";

// The signed-in user's role in the "Working as" company, for hiding buttons they can't use.
// This is only for the screen — lib/data checks every write again (assertCan).

const RoleContext = createContext<Role | null>(null);

export function PermissionsProvider({
  role,
  children,
}: {
  role: Role | null;
  children: ReactNode;
}) {
  return <RoleContext value={role}>{children}</RoleContext>;
}

export function useRole(): Role | null {
  return useContext(RoleContext);
}

export function useCan(action: Action): boolean {
  return can(useContext(RoleContext), action);
}

/**
 * Renders children only when the role allows the action (any of them, if a list).
 * Works inside server components too: <IfCan action="lr.edit"><Button …/></IfCan>.
 */
export function IfCan({
  action,
  children,
  fallback = null,
}: {
  action: Action | Action[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const role = useContext(RoleContext);
  const ok = (Array.isArray(action) ? action : [action]).some((a) => can(role, a));
  return ok ? children : fallback;
}
