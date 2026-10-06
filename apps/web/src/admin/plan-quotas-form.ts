import { JOB_DIGEST_FREQUENCIES, LIMITED_QUOTAS, PLANS, type Plan, type PlanQuotas } from "@jobhub/shared";
import * as z from "zod";

/** The largest limit the plan_quota table can hold (Postgres `integer`). */
const MAX_LIMIT = 2_147_483_647;

/** A limit field: a whole number from 0, or empty for unlimited. */
const limit = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.union([z.null(), z.string().trim().regex(/^\d+$/).transform(Number).pipe(z.number().max(MAX_LIMIT))]),
);

const schema = z.object({
  plan: z.enum(PLANS),
  ...Object.fromEntries(LIMITED_QUOTAS.map((quota) => [quota, limit])),
  jobDigest: z.enum(JOB_DIGEST_FREQUENCIES),
});

/** One Plan's quotas as submitted by the back-office form, or null if a value is invalid. */
export function planQuotasFromForm(form: FormData): { plan: Plan; quotas: PlanQuotas } | null {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return null;
  const { plan, ...quotas } = parsed.data as { plan: Plan } & PlanQuotas;
  return { plan, quotas };
}
