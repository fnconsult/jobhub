/** What a Tailored CV changes in its Master CV, section by section, for the Candidate's review. Safe to use in the browser. */
import type { CvContent, CvEducation, CvExperience, CvLanguage } from "@jobhub/shared";

export const CV_SECTIONS = ["headline", "summary", "experience", "education", "skills", "languages"] as const;
export type CvSection = (typeof CV_SECTIONS)[number];

/**
 * One change of a Tailored CV against its Master CV:
 *  - "rephrased": `master` and `tailored` give the text before and after (for a job, its title then its description);
 *  - "reordered": the section's items are in another order;
 *  - "cut": `item` is left out;
 *  - "added": `item` is a requirement the Candidate confirmed.
 * `item` names a job, diploma, skill or language as the Master CV writes it.
 */
export interface CvChange {
  section: CvSection;
  kind: "rephrased" | "reordered" | "cut" | "added";
  item?: string;
  master?: string;
  tailored?: string;
}

const jobLabel = (job: CvExperience) => [job.title, job.employer, job.period].filter(Boolean).join(" · ");
const jobText = (job: CvExperience) => [job.title, job.description].filter(Boolean).join("\n");
const jobKey = (job: CvExperience) => `${job.employer}\u0000${job.period}`;
const educationLabel = (item: CvEducation) => [item.degree, item.institution, item.year].filter(Boolean).join(" · ");
const languageLabel = (item: CvLanguage) => [item.name, item.level].filter(Boolean).join(" · ");

/** The changes of a list section: items cut, kept in another order, or added. */
function listChanges<T>(section: CvSection, master: T[], tailored: T[], key: (item: T) => string, label: (item: T) => string): CvChange[] {
  const masterKeys = master.map(key);
  const tailoredKeys = tailored.map(key);
  const kept = masterKeys.filter((item) => tailoredKeys.includes(item));
  const keptInTailoredOrder = tailoredKeys.filter((item) => masterKeys.includes(item));
  const changes: CvChange[] = master.filter((item) => !tailoredKeys.includes(key(item))).map((item) => ({ section, kind: "cut", item: label(item) }));
  if (kept.some((item, index) => keptInTailoredOrder[index] !== item)) changes.push({ section, kind: "reordered" });
  changes.push(...tailored.filter((item) => !masterKeys.includes(key(item))).map((item): CvChange => ({ section, kind: "added", item: label(item) })));
  return changes;
}

/** Every change of `tailored` against `master`, in the order of the CV's sections. */
export function cvChanges(master: CvContent, tailored: CvContent): CvChange[] {
  const changes: CvChange[] = [];
  for (const section of ["headline", "summary"] as const) {
    if (master[section] !== tailored[section]) changes.push({ section, kind: "rephrased", master: master[section], tailored: tailored[section] });
  }
  for (const job of master.experience) {
    const adapted = tailored.experience.find((option) => jobKey(option) === jobKey(job));
    if (adapted && jobText(adapted) !== jobText(job)) changes.push({ section: "experience", kind: "rephrased", item: jobLabel(job), master: jobText(job), tailored: jobText(adapted) });
  }
  changes.push(...listChanges("experience", master.experience, tailored.experience, jobKey, jobLabel));
  changes.push(...listChanges("education", master.education, tailored.education, educationLabel, educationLabel));
  changes.push(...listChanges("skills", master.skills, tailored.skills, (skill) => skill, (skill) => skill));
  changes.push(...listChanges("languages", master.languages, tailored.languages, languageLabel, languageLabel));
  return changes;
}
