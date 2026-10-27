import type { ActionOutcome } from "../ndjson";
import type { AddTargetCompanyResult } from "./index";

/**
 * How adding a Target Company by name ended, as its route answers:
 * 201 { company } · 400 { errors: [{ field: "name", code: "invalid" | "exists" | "not_a_company" }] }
 * (`invalid`: an empty name, or a Profile that is not the Candidate's).
 */
export function addedTargetCompanyOutcome(result: AddTargetCompanyResult): ActionOutcome {
  if (result.ok) return { status: 201, body: { company: result.company } };
  return { status: 400, body: { errors: [{ field: "name", code: result.error }] } };
}
