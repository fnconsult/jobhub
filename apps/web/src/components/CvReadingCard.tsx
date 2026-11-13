"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { yearsOfExperience, type Activity, type ContractType, type SearchCriteria } from "@jobhub/shared";
import type { CvDraft } from "@/cv";
import { Card } from "@/design/Card";
import { Properties, Property } from "@/design/Properties";
import { Stepper, type StepStatus } from "@/design/Stepper";
import { ActivityGlyph } from "./ActivityGlyph";
import { CoachLine } from "./CoachLine";
import "./ProfileOnboarding.css";

/** The fields the card reads out of a CV (#1003), in its order. */
export const READ_FIELDS = ["targetRole", "experience", "location", "skills", "contractTypes", "minSalary"] as const;
export type ReadField = (typeof READ_FIELDS)[number];

/** The skills named on the card; the rest counted. */
const SHOWN_SKILLS = 5;
/** Between two fields appearing, while the fields move (not under prefers-reduced-motion). */
export const FIELD_MS = 350;
/** Once every field is shown, how long the card stays open before the interview starts and it folds. */
export const READ_PAUSE_MS = 1200;

const READING_STEP = "reading";
const DONE: StepStatus = "done";
const CURRENT: StepStatus = "current";
/** The reading's glyph, as on the file's row while it is read. */
const READ: Activity = "read";

/** `t` over keys built from a field (`newProfile.fromCv.fields.*`, `cvReview.contractTypes.*`), as a plain function. */
type T = (key: string, options?: Record<string, unknown>) => string;

/** A draft as the card reads it: a CV's, its Search Criteria maybe holding more than a CV gives (contracts, a salary). */
type ReadDraft = Pick<CvDraft, "masterCv"> & { searchCriteria: CvDraft["searchCriteria"] & Partial<Pick<SearchCriteria, "contractTypes" | "minSalary">> };

/**
 * Each field the card shows, its value in words, or null when the CV does not give it: the target role and the place the
 * reading pre-filled, the years of experience (the span of the dated jobs, as the Match Score counts them), the skills;
 * the contract types and the salary a CV does not say, which the interview asks.
 */
export function readFields(draft: ReadDraft, t: T, language: "fr" | "en", today = new Date()): { field: ReadField; value: string | null }[] {
  const { masterCv, searchCriteria } = draft;
  const years = yearsOfExperience(masterCv, today);
  const skills = masterCv.skills.map((skill) => skill.trim()).filter(Boolean);
  const named = skills.slice(0, SHOWN_SKILLS).join(", ");
  const contracts = searchCriteria.contractTypes ?? [];
  const value: Record<ReadField, string | null> = {
    targetRole: searchCriteria.targetRole.trim() || null,
    experience: years !== undefined && years >= 1 ? t("newProfile.fromCv.years", { count: years }) : null,
    location: searchCriteria.locations.filter(Boolean).join(", ") || null,
    skills: skills.length === 0 ? null : skills.length > SHOWN_SKILLS ? t("newProfile.fromCv.moreSkills", { skills: named, count: skills.length - SHOWN_SKILLS }) : named,
    contractTypes: contracts.length > 0 ? contracts.map((type: ContractType) => t(`cvReview.contractTypes.${type}`)).join(", ") : null,
    minSalary: searchCriteria.minSalary ? `${new Intl.NumberFormat(language === "en" ? "en-GB" : "fr-FR").format(searchCriteria.minSalary)} €` : null,
  };
  return READ_FIELDS.map((field) => ({ field, value: value[field] }));
}

/** Whether the fields may appear one after the other: not under prefers-reduced-motion, nor where it cannot be asked. */
const fieldsMove = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

/** The fields, term and value; a field the CV does not give said absent, in italics. */
function ReadProperties({ fields, label }: { fields: readonly { field: ReadField; value: string | null }[]; label: string }) {
  const { t } = useTranslation();
  return (
    <Properties label={label}>
      {fields.map(({ field, value }) => (
        <Property key={field} term={t(`newProfile.fromCv.fields.${field}`)}>
          {value ?? <em>{t("newProfile.fromCv.missing")}</em>}
        </Property>
      ))}
    </Properties>
  );
}

/**
 * « Profil en construction » (#1003, ADR-0106), a card in the thread while the CV is read: its one step, « Lecture de
 * votre profil » (Stepper, #1001), under way while `/api/cv/draft` reads it (`draft` null), then its fields appearing one
 * by one once read, each said absent when the CV does not give it; the step done once all are shown, then `onRead` after a
 * pause, when the page folds it (CvReadLine). Under prefers-reduced-motion, the fields all appear at once and the step's
 * dot does not pulse.
 */
export function CvReadingCard({ draft, onRead }: { draft: ReadDraft | null; onRead?: () => void }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === "en" ? "en" : "fr";
  const fields = draft ? readFields(draft, t as unknown as T, language) : [];
  // Mounted with its draft, the fields all shown at once where they do not move; else one by one, from none.
  const [moving] = useState(() => draft !== null && fieldsMove());
  const [shown, setShown] = useState(() => (draft !== null && !moving ? READ_FIELDS.length : 0));
  const headingId = useId();
  const read = useRef(onRead);
  useEffect(() => {
    read.current = onRead;
  });

  useEffect(() => {
    if (!draft) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const steps = moving ? READ_FIELDS.length : 0;
    for (let index = 0; index < steps; index++) timers.push(setTimeout(() => setShown(index + 1), FIELD_MS * (index + 1)));
    timers.push(setTimeout(() => read.current?.(), FIELD_MS * steps + READ_PAUSE_MS));
    return () => timers.forEach(clearTimeout);
  }, [draft, moving]);

  const allShown = draft !== null && shown >= READ_FIELDS.length;
  return (
    <li className="chat-message chat-card">
      <Card title={t("newProfile.fromCv.building")} headingId={headingId}>
        <div className="onb-reading">
          <Stepper label={t("newProfile.fromCv.building")} steps={[{ id: READING_STEP, title: t("newProfile.fromCv.readingStep"), status: allShown ? DONE : CURRENT }]} />
          {shown > 0 ? <ReadProperties fields={fields.slice(0, shown)} label={t("newProfile.fromCv.readingStep")} /> : null}
        </div>
      </Card>
    </li>
  );
}

/**
 * The card folded (#1003), a line of the coach: « Profil construit à partir de votre CV · N informations lues », with the
 * reading's small glyph, opening on the fields read, as « Le coach a consulté… » opens on its elements (#788).
 */
export function CvReadLine({ draft }: { draft: ReadDraft }) {
  const { t, i18n } = useTranslation();
  const fields = readFields(draft, t as unknown as T, i18n.language === "en" ? "en" : "fr");
  const count = fields.filter(({ value }) => value !== null).length;
  return (
    <CoachLine>
      <details className="coach-tools-consulted onb-read">
        <summary>
          <ActivityGlyph activity={READ} />
          {t("newProfile.fromCv.built", { count })}
        </summary>
        <ReadProperties fields={fields} label={t("newProfile.fromCv.readingStep")} />
      </details>
    </CoachLine>
  );
}
