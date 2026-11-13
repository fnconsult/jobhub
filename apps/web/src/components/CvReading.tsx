"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReadFieldValue } from "@/ai-activity/cv-reading";
import { Properties, Property } from "@/design/Properties";
import { Stepper, type StepStatus } from "@/design/Stepper";

/** Between two fields appearing, while the fields move (not under prefers-reduced-motion). */
export const FIELD_MS = 350;
/** A reading ended this recently is shown being read out: its fields one by one; an older one, all at once. */
export const FRESH_MS = 10_000;

const READING_STEP = "reading";
const DONE: StepStatus = "done";
const CURRENT: StepStatus = "current";

/** Whether the fields may appear one after the other: not under prefers-reduced-motion, nor where it cannot be asked. */
const fieldsMove = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

/** « Lecture de votre profil », the one step of a CV read on `/profils/nouveau` (#1003): under way, or done. */
function ReadingStep({ done }: { done: boolean }) {
  const { t } = useTranslation();
  return <Stepper label={t("newProfile.fromCv.building")} steps={[{ id: READING_STEP, title: t("newProfile.fromCv.readingStep"), status: done ? DONE : CURRENT }]} />;
}

/**
 * The CV being read on `/profils/nouveau` (#1003, ADR-0106), in its « En ce moment » entry: « Profil en construction », its
 * one step « Lecture de votre profil » under way (Stepper, #1001), its dot still under prefers-reduced-motion. What it
 * reads shows in its history part once read (CvReadFields): `/api/cv/draft` gives it all at once.
 */
export function CvReadingNow({ running }: { running: boolean }) {
  return (
    <div className="en-ce-moment-followed">
      <ReadingStep done={!running} />
    </div>
  );
}

/**
 * The fields a CV read gave (#1003), in « Création du profil »'s part « Lecture du CV »: its step done, then each field,
 * term and value (Properties), one absent said « Pas encore dans votre profil » in italics. Read just now (`at`), they
 * appear one by one; under prefers-reduced-motion, or read earlier, all at once.
 */
export function CvReadFields({ fields, at }: { fields: readonly ReadFieldValue[]; at: string | null }) {
  const { t } = useTranslation();
  const [moving] = useState(() => fieldsMove() && at !== null && Date.now() - Date.parse(at) < FRESH_MS);
  const [shown, setShown] = useState(() => (moving ? 0 : fields.length));
  useEffect(() => {
    if (!moving) return;
    const timers = fields.map((_, index) => setTimeout(() => setShown(index + 1), FIELD_MS * (index + 1)));
    return () => timers.forEach(clearTimeout);
  }, [moving, fields]);
  return (
    <div className="en-ce-moment-followed">
      <ReadingStep done={shown >= fields.length} />
      {shown > 0 ? (
        <Properties label={t("newProfile.fromCv.readingStep")}>
          {fields.slice(0, shown).map(({ field, value }) => (
            <Property key={field} term={t(`newProfile.fromCv.fields.${field}`)}>
              {value ?? <em>{t("newProfile.fromCv.missing")}</em>}
            </Property>
          ))}
        </Properties>
      ) : null}
    </div>
  );
}
