"use client";

import { ACTIVITIES, type Activity, type StepLabel } from "@jobhub/shared";
import { useTranslation } from "react-i18next";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import "./ActivityGlyphs.css";

/** The other Step label a glyph stands for: a Guardrail's check is drawn thinking, a Coach Action's proposal acting (#726). */
const ALSO: Partial<Record<Activity, StepLabel>> = { think: "check", act: "propose" };

/**
 * Every Activity's glyph (ADR-0034, #314), still, as reduced motion and an ended step show it, beside its Step label in
 * words and its id: the Design System page's reference for them, compared in its screenshots.
 */
export function ActivityGlyphs() {
  const { t } = useTranslation();
  return (
    <ul className="ds-activity-glyphs" aria-label={t("designSystem.page.activityGlyphs")}>
      {ACTIVITIES.map((activity) => {
        const also = ALSO[activity];
        return (
          <li key={activity} className="ds-activity-glyphs__item">
            <ActivityGlyph activity={activity} />
            <span>{also ? `${t(`aiActivity.steps.${activity}`)} · ${t(`aiActivity.steps.${also}`)}` : t(`aiActivity.steps.${activity}`)}</span>
            <code className="ds-activity-glyphs__id">{activity}</code>
          </li>
        );
      })}
    </ul>
  );
}
