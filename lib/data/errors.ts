import type { RuleError } from "@/lib/validators/common";

/** Input failed validation; issues carry the field path to highlight. */
export class ValidationError extends Error {
  readonly issues: RuleError[];
  constructor(issues: RuleError[]) {
    super(issues.map((i) => i.message).join("; "));
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/** Someone else saved the record after this user opened it. */
export class ConflictError extends Error {
  constructor() {
    super("This record was changed by someone else — reload and try again.");
    this.name = "ConflictError";
  }
}

/** No such record in the active company (or it belongs to another company). */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** The user's role in this company doesn't allow the action. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * The in-memory sample store was touched outside unit tests — a bug: every lib/data function
 * must go to lib/data/db/* when running on the database. Never shows sample data instead.
 */
export class MockStoreError extends Error {
  constructor() {
    super("Internal error: sample data is only for unit tests.");
    this.name = "MockStoreError";
  }
}

/** What a server action hands back to a form when a data call throws. */
export type ActionFailure =
  | { ok: false; kind: "validation"; issues: RuleError[]; message: string }
  | { ok: false; kind: "conflict"; message: string }
  | { ok: false; kind: "error"; message: string };

/** Known data errors become an ActionFailure; anything else is a bug and is re-thrown. */
export function toActionFailure(e: unknown): ActionFailure {
  if (e instanceof ValidationError)
    return { ok: false, kind: "validation", issues: e.issues, message: e.message };
  if (e instanceof ConflictError) return { ok: false, kind: "conflict", message: e.message };
  if (e instanceof NotFoundError || e instanceof ForbiddenError)
    return { ok: false, kind: "error", message: e.message };
  throw e;
}
