/**
 * What « Création du profil » shows of a CV read on `/profils/nouveau` (#1003, ADR-0106): the fields the reading gave, in
 * words, each null when the CV does not give it, for its history part in Activité (CvReadFields). Pure, and safe in the
 * browser.
 *
 *   readFields(draft, t, language)   Poste visé, Expérience en années, Basé à, Compétences, Types de contrat, Salaire souhaité
 */
import { yearsOfExperience, type ContractType, type CvContent, type SearchCriteria } from "@jobhub/shared";

/** The fields of a CV read, in their order. */
export const READ_FIELDS = ["targetRole", "experience", "location", "skills", "contractTypes", "minSalary"] as const;
export type ReadField = (typeof READ_FIELDS)[number];

/** One field read: its value in words, or null when the CV does not give it. */
export interface ReadFieldValue {
  field: ReadField;
  value: string | null;
}

/** The skills named; the rest counted. */
const SHOWN_SKILLS = 5;

/** `t` over keys built from a field (`newProfile.fromCv.*`, `cvReview.contractTypes.*`), as a plain function. */
export type T = (key: string, options?: Record<string, unknown>) => string;

/** A draft as a CV reading gives it: its Search Criteria maybe holding more than a CV gives (contracts, a salary). */
export interface ReadDraft {
  masterCv: Pick<CvContent, "experience" | "skills">;
  searchCriteria: Pick<SearchCriteria, "targetRole" | "locations"> & Partial<Pick<SearchCriteria, "contractTypes" | "minSalary">>;
}

/**
 * Each field of the draft, in words, or null when the CV does not give it: the target role and the places the reading
 * pre-filled, the years of experience (the span of the dated jobs, as the Match Score counts them), the skills; the
 * contract types and the salary, which a CV reading does not fill and the interview asks.
 */
export function readFields(draft: ReadDraft, t: T, language: "fr" | "en", today = new Date()): ReadFieldValue[] {
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
