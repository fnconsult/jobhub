/**
 * Consumption (#799, ADR-0091): what « Votre consommation » counts, a Candidate's uses per Tool and per day. A Tool here
 * is a feature the Candidate uses, not an external service: one key per feature, whatever started it (an action from
 * the browser extension counts under its feature), each with its French and English label and the unit its count is in.
 * The order is the one the section shows.
 */
import type { WeeklyQuota } from "./domain";

type Wording = { label: string; unit: string };

export const CONSUMPTION_TOOLS = {
  coach: { fr: { label: "Coach IA", unit: "réponses" }, en: { label: "AI Coach", unit: "replies" } },
  jobSearch: { fr: { label: "Recherches d'offres", unit: "recherches" }, en: { label: "Job searches", unit: "searches" } },
  matchScore: { fr: { label: "Match Score", unit: "scores" }, en: { label: "Match Score", unit: "scores" } },
  tailoredCv: { fr: { label: "CV adapté", unit: "CV" }, en: { label: "Tailored CV", unit: "CVs" } },
  tailoredDocument: { fr: { label: "Lettres et messages d'approche", unit: "documents" }, en: { label: "Cover letters and outreach messages", unit: "documents" } },
  atsScore: { fr: { label: "ATS Score", unit: "analyses" }, en: { label: "ATS Score", unit: "analyses" } },
  companyDossier: { fr: { label: "Dossier entreprise", unit: "dossiers" }, en: { label: "Company dossier", unit: "dossiers" } },
  enrichedContact: { fr: { label: "Contacts enrichis", unit: "contacts" }, en: { label: "Enriched contacts", unit: "contacts" } },
  cvReading: { fr: { label: "Lecture de CV", unit: "CV lus" }, en: { label: "CV reading", unit: "CVs read" } },
} as const satisfies Record<string, { fr: Wording; en: Wording }>;

/** A Tool key of Consumption. */
export type ConsumptionTool = keyof typeof CONSUMPTION_TOOLS;

/** The Tool keys, in the order « Votre consommation » shows them. */
export function consumptionTools(): ConsumptionTool[] {
  return Object.keys(CONSUMPTION_TOOLS) as ConsumptionTool[];
}

export function isConsumptionTool(value: unknown): value is ConsumptionTool {
  return typeof value === "string" && Object.hasOwn(CONSUMPTION_TOOLS, value);
}

/** The Tool a weekly Plan Quota's use counts under: counted where the use is recorded, given back with it. */
export const QUOTA_CONSUMPTION_TOOLS = {
  jobSearches: "jobSearch",
  matchScores: "matchScore",
  atsScores: "atsScore",
  enrichedContacts: "enrichedContact",
} as const satisfies Record<WeeklyQuota, ConsumptionTool>;
