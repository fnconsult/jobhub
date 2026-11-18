/**
 * The fields the onboarding interview asks or proposes. Free of imports, so a module the worker compiles too (the four
 * blocks, through the Profiles module, #1046) can name a field without pulling in the turn's `@/` imports.
 */
/** The Search Criteria fields the interview asks or proposes, in the order a Profile needs them. */
export const CRITERIA_FIELDS = ["targetRole", "locations", "contractTypes", "remoteWorkOptions", "minSalary", "sectors", "subsectors", "domains"] as const;
/** The Master CV fields; an entry of a section by `section.field` (a new job starts with its title, a new degree with its name). */
export const CV_FIELDS = [
  "fullName",
  "headline",
  "email",
  "phone",
  "location",
  "summary",
  "skills",
  "languages",
  "experience.title",
  "experience.employer",
  "experience.location",
  "experience.period",
  "experience.description",
  "education.degree",
  "education.institution",
  "education.year",
] as const;
export const INTERVIEW_FIELDS = [...CRITERIA_FIELDS, ...CV_FIELDS] as const;
export type InterviewField = (typeof INTERVIEW_FIELDS)[number];

export const isInterviewField = (field: unknown): field is InterviewField => typeof field === "string" && (INTERVIEW_FIELDS as readonly string[]).includes(field);
