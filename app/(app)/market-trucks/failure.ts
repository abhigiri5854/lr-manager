// Shared by the Market Trucks server actions: expected errors become a result the form shows.
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/data/errors";
import type { RuleError } from "@/lib/validators/common";

export type ActionFailure =
  | { ok: false; kind: "validation"; issues: RuleError[]; message: string }
  | { ok: false; kind: "conflict"; message: string }
  | { ok: false; kind: "error"; message: string };

export function toFailure(e: unknown): ActionFailure {
  if (e instanceof ValidationError)
    return { ok: false, kind: "validation", issues: e.issues, message: e.message };
  if (e instanceof ConflictError) return { ok: false, kind: "conflict", message: e.message };
  if (e instanceof NotFoundError || e instanceof ForbiddenError)
    return { ok: false, kind: "error", message: e.message };
  throw e;
}
