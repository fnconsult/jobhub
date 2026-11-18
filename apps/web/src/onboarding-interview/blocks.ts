/**
 * The four blocks of the onboarding interview without a CV (#1046): once the Profile is born (its target role and a place
 * validated, #999), the AI Coach asks the rest in four blocks, in this order: the criteria, the career, the skills, the
 * presentation. The thread marks where each starts (« Bloc deux sur quatre »), once; « Continuer plus tard » keeps the
 * block reached, where « Reprendre la création » reopens the interview. Pure, and safe in the browser.
 *
 *   blockOf(field)                    the block a field is asked in; null for the target role and a place
 *   blockProgress(fields, from?)      for the fields asked, in order: the block each question starts (else null), and
 *                                     the block reached; never back to an earlier one, from the block resumed at
 */
import type { InterviewField } from "./fields";

export const INTERVIEW_BLOCKS = ["criteria", "career", "skills", "presentation"] as const;
export type InterviewBlock = (typeof INTERVIEW_BLOCKS)[number];
export const BLOCK_COUNT = INTERVIEW_BLOCKS.length;

/** The fields each block asks: what the Profile is born with is in none. */
export const BLOCK_FIELDS: Record<InterviewBlock, readonly InterviewField[]> = {
  criteria: ["contractTypes", "remoteWorkOptions", "minSalary", "sectors", "subsectors", "domains"],
  career: [
    "experience.title",
    "experience.employer",
    "experience.location",
    "experience.period",
    "experience.description",
    "education.degree",
    "education.institution",
    "education.year",
  ],
  skills: ["skills", "languages"],
  presentation: ["headline", "summary", "fullName", "email", "phone", "location"],
};

export const isInterviewBlock = (block: unknown): block is InterviewBlock => (INTERVIEW_BLOCKS as readonly unknown[]).includes(block);

/** The block's place, 1 to BLOCK_COUNT. */
export const blockNumber = (block: InterviewBlock): number => INTERVIEW_BLOCKS.indexOf(block) + 1;

export function blockOf(field: InterviewField): InterviewBlock | null {
  return INTERVIEW_BLOCKS.find((block) => BLOCK_FIELDS[block].includes(field)) ?? null;
}

export interface BlockProgress {
  /** For each question, the block it starts, or null: one mark per block, never one per question. */
  marks: (InterviewBlock | null)[];
  /** The block reached: the first one before any of its questions, or the one resumed at. */
  current: InterviewBlock;
}

/**
 * Where the interview stands in its blocks after the questions on `fields`, in order: a question on an earlier block than
 * the one reached counts in the one reached; `from`, the block « Reprendre la création » reopens it at.
 */
export function blockProgress(fields: readonly InterviewField[], from: InterviewBlock | null = null): BlockProgress {
  let reached = from ? blockNumber(from) : 0;
  let marked = 0;
  const marks = fields.map((field) => {
    const block = blockOf(field);
    if (block) reached = Math.max(reached, blockNumber(block));
    if (reached === 0 || reached === marked) return null;
    marked = reached;
    return INTERVIEW_BLOCKS[reached - 1]!;
  });
  return { marks, current: INTERVIEW_BLOCKS[Math.max(reached, 1) - 1]! };
}
