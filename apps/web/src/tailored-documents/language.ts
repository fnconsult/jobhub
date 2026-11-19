/**
 * Whether a Cover Letter or an Outreach Message is wholly in its Document Language: its paragraphs written in
 * another one. A cheap, deterministic check (`textLanguage`): a paragraph too short to tell (« Dear Ms Martin, »)
 * or one quoting a French job title within an English sentence is in the language its sentence is in.
 */
import { textLanguage, type DocumentLanguage } from "@jobhub/shared";

/** The paragraphs of `text` written in another language than `language`, as written: none when it is wholly in it. */
export function paragraphsNotIn(text: string, language: DocumentLanguage): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => {
      const found = paragraph ? textLanguage(paragraph) : null;
      return found !== null && found !== language;
    });
}
