/**
 * Turning an uploaded CV into a draft the Candidate reviews before it becomes
 * their Profile: a structured Master CV and Search Criteria pre-filled from it.
 *
 * One deep module. Callers get `draftFromCv(file, { ai, candidateId })`, which
 * accepts PDF and Word (.docx) files and throws `CvFileError` (with a `code`)
 * for anything it cannot read. File formats, the AI Coach's reading of the CV
 * and the rule-based fallback when that reading fails all stay behind it.
 * Nothing is saved here: saving the reviewed draft is the Profiles module's job,
 * and a Guest's CV is never saved at all (ADR-0003).
 */
import type { AiLayer } from "@jobhub/ai";
import type { MasterCvContent } from "@jobhub/shared";
import { fitProfileName } from "../profiles/limits";
import { readCvWithAi } from "./ai-reading";
import { outlineCv } from "./outline-cv";
import { readCvFile, type CvFile } from "./read-cv-file";

export { CvFileError, MAX_CV_FILE_BYTES, type CvFile, type CvFileErrorCode } from "./read-cv-file";

/** Search Criteria as pre-filled from a CV: the Candidate completes them during review. */
export interface SearchCriteriaDraft {
  targetRole: string;
  location: string;
}

export interface CvDraft {
  masterCv: MasterCvContent;
  searchCriteria: SearchCriteriaDraft;
}

export interface DraftDeps {
  ai: AiLayer;
  /**
   * The Candidate uploading the CV (AI usage is counted against them), or null
   * for a Guest, whose CV is read by rules alone: it is not sent to an AI
   * provider without an account (ADR-0003).
   */
  candidateId: string | null;
}

export async function draftFromCv(file: CvFile, deps: DraftDeps): Promise<CvDraft> {
  const { text, photo } = await readCvFile(file);
  const reading = deps.candidateId === null ? null : await readCvWithAi(text, deps.ai, deps.candidateId);
  // Only the file tells whether the CV shows a photo: neither reading of its text can.
  const read: MasterCvContent = { ...(reading?.masterCv ?? outlineCv(text)) };
  delete read.photo;
  const masterCv: MasterCvContent = photo ? { ...read, photo } : read;
  return {
    masterCv,
    searchCriteria: {
      // It names the Profile, so it is shortened to fit a Profile name.
      targetRole: fitProfileName(reading?.searchCriteria.targetRole || masterCv.headline || masterCv.experience[0]?.title || ""),
      location: reading?.searchCriteria.location || masterCv.location,
    },
  };
}
