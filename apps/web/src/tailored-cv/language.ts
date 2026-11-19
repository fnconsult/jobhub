/**
 * Whether a CV is wholly in its Document Language: the texts it still holds in another language, each as
 * written, a description's bullets one by one. `propose` asks the AI Coach once more for those it finds (#1077).
 * A cheap, deterministic check (`textLanguage`): a text too short to tell (a proper noun, a figure, « IFRS »)
 * never counts. Safe to use in the browser.
 */
import { textLanguage, type CvContent, type DocumentLanguage } from "@jobhub/shared";

/** Every text of `cv` a Candidate reads, in its order: the identity block is left out, it is not translated. */
function textsOf(cv: CvContent): string[] {
  return [
    cv.headline,
    cv.summary,
    // A description is read line by line: each bullet is a text of its own, so one left in French is found.
    ...cv.experience.flatMap((job) => [job.title, job.period, ...job.description.split("\n")]),
    ...cv.education.map((item) => item.degree),
    ...cv.skills,
    ...cv.languages.flatMap((item) => [item.name, item.level]),
  ];
}

/** The texts of `cv` written in another language than `language`: none when it is wholly in it. */
export function textsNotIn(cv: CvContent, language: DocumentLanguage): string[] {
  return textsOf(cv).filter((text) => {
    const found = textLanguage(text);
    return found !== null && found !== language;
  });
}
