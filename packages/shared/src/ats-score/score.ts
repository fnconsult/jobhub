/**
 * ATS Score: how well a Master CV would pass applicant tracking systems, 0–100,
 * half Readability and half keyword coverage for the Profile's target role.
 * Independent of any Job Offer. Pure and synchronous, with fixed rules (like
 * the Match Score, ADR-0013), so it can be recomputed at no cost after each
 * accepted ATS Fix.
 */
import type { CvContent } from "../domain";
import { normalise } from "../text";
import { keywordsFor } from "./keywords";

/** What an ATS needs to read a CV, each worth the same share of Readability. */
export const READABILITY_CHECKS = ["contact", "headline", "summary", "datedExperience", "skillsList", "plainText"] as const;
export type ReadabilityCheck = (typeof READABILITY_CHECKS)[number];

export interface ReadabilityBreakdown {
  score: number;
  checks: { check: ReadabilityCheck; passed: boolean }[];
}

export interface KeywordsBreakdown {
  score: number;
  /** In the headline or the skills (or, for the target role, a job title): where an ATS looks first. */
  listed: string[];
  /** Only in the summary, the job descriptions or the education: worth half. */
  mentioned: string[];
  /** Nowhere on the CV. Only the Candidate can add them, if they are true. */
  missing: string[];
}

export interface AtsScore {
  score: number;
  breakdown: { readability: ReadabilityBreakdown; keywords: KeywordsBreakdown };
}

export interface AtsInput {
  cv: CvContent;
  /** The Profile's target role (its Search Criteria). */
  targetRole: string;
}

/** Symbols an ATS reads as noise: emoji, stars, arrows, check marks. A plain "•" bullet is fine. */
export const DECORATION = /[\p{Extended_Pictographic}★☆►▶▸▪■□◆◇●○✓✔✗✘➢➤➔→⇒❖✦✧]/u;
/** Skills written as one line instead of one skill each. */
export const SKILL_SEPARATOR = /\s*[,;•|]\s*/;

/** Every free text of a CV, where decorations or age-related details may hide. */
export function cvTexts(cv: CvContent): string[] {
  return [
    cv.fullName,
    cv.headline,
    cv.summary,
    ...cv.skills,
    ...cv.experience.flatMap((job) => [job.title, job.employer, job.period, job.description]),
    ...cv.education.flatMap((item) => [item.degree, item.institution]),
  ];
}

const hasYear = (period: string) => /\b(19|20)\d{2}\b/.test(period);

function readability(cv: CvContent): { breakdown: ReadabilityBreakdown; exact: number } {
  const passed: Record<ReadabilityCheck, boolean> = {
    contact: cv.email.trim() !== "" && cv.phone.trim() !== "",
    headline: cv.headline.trim() !== "",
    summary: cv.summary.trim() !== "",
    datedExperience: cv.experience.length > 0 && cv.experience.every((job) => hasYear(job.period)),
    skillsList: cv.skills.length >= 3 && cv.skills.every((skill) => !SKILL_SEPARATOR.test(skill.trim())),
    plainText: !cvTexts(cv).some((text) => DECORATION.test(text)),
  };
  const checks = READABILITY_CHECKS.map((check) => ({ check, passed: passed[check] }));
  const exact = (100 * checks.filter((item) => item.passed).length) / checks.length;
  return { breakdown: { score: Math.round(exact), checks }, exact };
}

function keywordCoverage(cv: CvContent, targetRole: string): { breakdown: KeywordsBreakdown; exact: number } {
  const listedText = normalise([cv.headline, ...cv.skills].join(" | "));
  const titles = normalise(cv.experience.map((job) => job.title).join(" | "));
  const bodyText = normalise(
    [cv.summary, ...cv.experience.map((job) => job.description), ...cv.education.map((item) => item.degree)].join(" | "),
  );
  const role = targetRole.trim();
  const breakdown: KeywordsBreakdown = { score: 0, listed: [], mentioned: [], missing: [] };
  for (const keyword of [role, ...keywordsFor(role)]) {
    const wanted = normalise(keyword);
    if (listedText.includes(wanted) || (keyword === role && titles.includes(wanted))) breakdown.listed.push(keyword);
    else if (bodyText.includes(wanted) || titles.includes(wanted)) breakdown.mentioned.push(keyword);
    else breakdown.missing.push(keyword);
  }
  const total = breakdown.listed.length + breakdown.mentioned.length + breakdown.missing.length;
  const exact = (100 * (breakdown.listed.length + breakdown.mentioned.length / 2)) / total;
  breakdown.score = Math.round(exact);
  return { breakdown, exact };
}

export function scoreAts({ cv, targetRole }: AtsInput): AtsScore {
  const readable = readability(cv);
  const covered = keywordCoverage(cv, targetRole);
  return {
    score: Math.round((readable.exact + covered.exact) / 2),
    breakdown: { readability: readable.breakdown, keywords: covered.breakdown },
  };
}
