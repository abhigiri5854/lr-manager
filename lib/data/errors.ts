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
