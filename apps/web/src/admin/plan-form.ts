import type { PlanStatus } from "@jobhub/shared";

/**
 * A Plan as submitted by the Back Office's Plan form, for `createPlan` / `updatePlan`,
 * which check every value: the box "Offered to Candidates" ticked or not, the Plan
 * Features ticked, and an empty Stripe product read as none.
 */
export function planFromForm(form: FormData): { key: string; name: { fr: string; en: string }; status: PlanStatus; stripeProductId: string | null; features: string[] } {
  const text = (field: string) => String(form.get(field) ?? "").trim();
  return {
    key: text("key"),
    name: { fr: text("nameFr"), en: text("nameEn") },
    status: form.get("offered") ? "offered" : "hidden",
    stripeProductId: text("stripeProductId") || null,
    features: form.getAll("features").map(String),
  };
}
