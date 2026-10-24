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
 *
 * A draft the AI Coach read keeps its Provenance (ADR-0034, #335): the reading step, its site the Candidate's
 * own CV, each step told to `onEvent` as it starts and ends. The Candidate's Stop (`signal`) throws
 * `CvReadingStopped`: nothing is drafted, not even the rule-based outline, so no Master CV Version comes of it.
 */
import type { AiLayer } from "@jobhub/ai";
import { distinctLocations, type MasterCvContent, type Provenance, type ProvenanceEvent } from "@jobhub/shared";
import { fitProfileName } from "../profiles/limits";
import type { TaskPlaybookReader } from "../task-playbooks";
import { readCvWithAi } from "./ai-reading";
import { outlineCv } from "./outline-cv";
import { readCvFile, type CvFile } from "./read-cv-file";

export { CvFileError, MAX_CV_FILE_BYTES, type CvFile, type CvFileErrorCode } from "./read-cv-file";

/**
 * Search Criteria as pre-filled from a CV: the Candidate completes them during review.
 * `locations` holds the one place the CV gives, or none.
 */
export interface SearchCriteriaDraft {
  targetRole: string;
  locations: string[];
}

export interface CvDraft {
  masterCv: MasterCvContent;
  searchCriteria: SearchCriteriaDraft;
  /** What read it (ADR-0034, #335), when the AI Coach did; absent when read by rules alone, or not read from a file. */
  provenance?: Provenance;
}

/** The Candidate stopped the reading (#335): nothing is drafted. */
export class CvReadingStopped extends Error {
  override name = "CvReadingStopped";
}

export interface DraftDeps {
  /**
   * The AI layer, built only when a Candidate's CV is read by the AI Coach. An
   * invalid AI configuration (`AiConfigError`) is then treated like any AI
   * failure: the rule-based outline is used. A Guest's draft never calls it.
   */
  ai: () => AiLayer;
  /**
   * The Candidate uploading the CV (AI usage is counted against them), or null
   * for a Guest, whose CV is read by rules alone: it is not sent to an AI
   * provider without an account (ADR-0003).
   */
  candidateId: string | null;
  /** The "cv-reading" task Playbook's served version (ADR-0026); without it, its built-in text. */
  taskPlaybooks?: TaskPlaybookReader;
  /** The Candidate's Stop (#335): aborts the reading, and `draftFromCv` throws `CvReadingStopped`. */
  signal?: AbortSignal;
  /** Hears the reading's step start and end, as AI Activity shows them live. */
  onEvent?: (event: ProvenanceEvent) => void;
}

export async function draftFromCv(file: CvFile, deps: DraftDeps): Promise<CvDraft> {
  const { text, photo } = await readCvFile(file);
  const { signal, onEvent } = deps;
  const read = deps.candidateId === null ? null : await readCvWithAi(text, deps.ai, deps.candidateId, { taskPlaybooks: deps.taskPlaybooks, signal, onEvent });
  if (signal?.aborted) throw new CvReadingStopped();
  const reading = read?.draft ?? null;
  // Only the file tells whether the CV shows a photo: neither reading of its text can.
  const content: MasterCvContent = { ...(reading?.masterCv ?? outlineCv(text)) };
  delete content.photo;
  const masterCv: MasterCvContent = photo ? { ...content, photo } : content;
  return {
    ...(reading && read?.provenance ? { provenance: read.provenance } : {}),
    masterCv,
    searchCriteria: {
      // It names the Profile, so it is shortened to fit a Profile name.
      targetRole: fitProfileName(reading?.searchCriteria.targetRole || masterCv.headline || masterCv.experience[0]?.title || ""),
      locations: reading?.searchCriteria.locations.length ? reading.searchCriteria.locations : distinctLocations([masterCv.location]),
    },
  };
}
