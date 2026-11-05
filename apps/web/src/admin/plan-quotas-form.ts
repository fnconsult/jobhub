import { JOB_DIGEST_FREQUENCIES, LIMITED_QUOTAS, type CoachContextLimits, type Plan, type PlanQuotas } from "@jobhub/shared";
import * as z from "zod";

/** The largest limit the plan_quota and plan_coach_context tables can hold (Postgres `integer`). */
const MAX_LIMIT = 2_147_483_647;

/** A limit field: a whole number from `min`, or empty for unlimited. */
const limitFrom = (min: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.union([z.null(), z.string().trim().regex(/^\d+$/).transform(Number).pipe(z.number().min(min).max(MAX_LIMIT))]),
  );
const limit = limitFrom(0);

const schema = z.object({
  /** A Plan's key; billing ignores one that is no Plan. */
  plan: z.string().regex(/^[a-z][a-z0-9-]*$/),
  ...Object.fromEntries(LIMITED_QUOTAS.map((quota) => [quota, limit])),
  jobDigest: z.enum(JOB_DIGEST_FREQUENCIES),
  /** The Coach context limits (ADR-0078): the AI Coach reads at least the Candidate's message. Absent from a form without them. */
  coachContextMessages: limitFrom(1).optional(),
  coachContextTokens: limit.optional(),
});

/** One Plan's quotas, with its Coach context limits when the form has them, as submitted by the back-office form, or null if a value is invalid. */
export function planQuotasFromForm(form: FormData): { plan: Plan; quotas: PlanQuotas & Partial<CoachContextLimits> } | null {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return null;
  const { plan, ...quotas } = parsed.data as { plan: Plan } & PlanQuotas & Partial<CoachContextLimits>;
  return { plan, quotas };
}

/**
 * The notice of a Quota Reduction a Back Office form sends with it (#514): its reason and effective date, trimmed; null
 * when it gives neither (a change that lowers nothing needs none).
 */
export function reductionNoticeFromForm(form: FormData): { reason: string; effectiveOn: string } | null {
  const reason = String(form.get("reductionReason") ?? "").trim();
  const effectiveOn = String(form.get("reductionEffectiveOn") ?? "").trim();
  return reason || effectiveOn ? { reason, effectiveOn } : null;
}
