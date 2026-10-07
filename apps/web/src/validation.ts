import type * as z from "zod";

/** A field the caller must fix, as a dotted path (e.g. "searchCriteria.location"). */
export interface FieldError {
  field: string;
  /** "too_long": over a string's maximum length (e.g. PROFILE_NAME_MAX_LENGTH for a Profile name). */
  code: "required" | "too_long" | "invalid";
}

/**
 * The fields to fix, from a failed Zod parse. Needs issues parsed with
 * `reportInput: true` (Zod v4 leaves `issue.input` out otherwise): a field is
 * "required" only when nothing, or a blank string, was sent for it.
 */
export function fieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    code:
      (issue.code === "too_small" && issue.origin === "string") || (issue.code === "invalid_type" && issue.input === undefined)
        ? "required"
        : issue.code === "too_big" && issue.origin === "string"
          ? "too_long"
          : "invalid",
  }));
}
