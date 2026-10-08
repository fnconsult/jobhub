import type { AtsFix, CvContent } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";

/** The title and body of the Action Card proposing `fix` on `cv`, in `locale`. Senior Advice says it may be ignored. */
export function cardText(fix: AtsFix, cv: CvContent, locale: Locale): { title: string; body: string } {
  const { t } = createI18n(locale);
  const { change } = fix;
  const params: Record<string, string | number> = { current: cv.headline };
  switch (change.type) {
    case "set_headline":
      params.headline = change.headline;
      break;
    case "list_skill":
      params.skill = change.skill;
      break;
    case "split_skill":
      Object.assign(params, { skill: change.skill, count: change.into.length, into: change.into.join(", ") });
      break;
    case "replace_text":
      Object.assign(params, { from: change.from, to: change.to });
      break;
    case "remove_experience":
      Object.assign(params, change.experience);
      break;
    case "remove_decorations":
      break;
  }
  const title = t(`atsFixes.reasons.${fix.reason}.title`, params);
  const body = t(`atsFixes.reasons.${fix.reason}.body`, params);
  return fix.category === "senior_advice" ? { title, body: `${body} ${t("atsFixes.seniorAdviceOptional")}` } : { title, body };
}
