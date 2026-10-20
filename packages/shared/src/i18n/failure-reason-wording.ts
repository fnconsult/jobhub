import type { FailureReason } from "../failure-reasons";
import { createI18n } from "./index";

/** A Failure Reason code's wording, French by default: what an Administrator, or a Candidate in their Data export, reads. */
export function failureReasonWording(code: FailureReason, locale: string = "fr"): string {
  let i18n = translators.get(locale);
  if (!i18n) translators.set(locale, (i18n = createI18n(locale)));
  return i18n.t(`failureReasons.${code}`);
}

const translators = new Map<string, ReturnType<typeof createI18n>>();
