/**
 * Task Playbooks as written in this repo (ADR-0026): the working instructions of each AI task, imported
 * as their version 1, and read by the code as its built-in text when no version is served. Pure (no
 * file access), so the AI layer and the web app share it.
 *
 *   taskPlaybookSeed("cv-reading")?.instructions;          // version 1 of its text
 *   taskSection(text, "fr");                               // the `## fr` section of a text, or null
 *   fillSlots("… {{entreprise}} …", { entreprise: "« Acme »" });
 *   taskInstructionsProblems(seed, text);                  // ["## en", "{{lieu}}"]: what a text lacks
 *   runsOnAgent("company-facts-search", text);             // false for its version 1: the search alone
 *
 * A task Playbook's text is the rules part of the task's instructions only: the output shape the code
 * reads, its safety rules and the data it passes in stay in code. A text with sections holds one
 * `## key` heading per variant the code picks (a language, a channel); a `{{slot}}` is where the code
 * puts in a value it cleaned.
 */
import { backOfficeAssistant } from "./back-office-assistant";
import { coachMemory } from "./coach-memory";
import { companyFactsSearch } from "./company-facts-search";
import { companyNewsSearch } from "./company-news-search";
import { coverLetter } from "./cover-letter";
import { cvReading } from "./cv-reading";
import { followUp } from "./follow-up";
import { jobOfferEmailReading } from "./job-offer-email-reading";
import { jobOfferReading } from "./job-offer-reading";
import { jobSearchQueries } from "./job-search-queries";
import { outreachMessage } from "./outreach-message";
import { tailoredCv } from "./tailored-cv";
import type { TaskPlaybookSeed } from "./types";

export type { TaskPlaybookSeed, TaskPlaybookSection } from "./types";

/** Every task Playbook, in the order the Back Office lists them. */
export const TASK_PLAYBOOKS = [
  jobOfferReading,
  jobOfferEmailReading,
  cvReading,
  tailoredCv,
  coverLetter,
  outreachMessage,
  followUp,
  coachMemory,
  companyFactsSearch,
  companyNewsSearch,
  jobSearchQueries,
  backOfficeAssistant,
] as const satisfies readonly TaskPlaybookSeed[];

export type TaskPlaybookId = (typeof TASK_PLAYBOOKS)[number]["id"];

export const isTaskPlaybookId = (id: string): id is TaskPlaybookId => TASK_PLAYBOOKS.some((seed) => seed.id === id);

/** A task Playbook as written in this repo; undefined for an id the code does not know. */
export function taskPlaybookSeed(id: string): TaskPlaybookSeed | undefined {
  return TASK_PLAYBOOKS.find((seed) => seed.id === id);
}

const HEADING = /^##[ \t]+(.+?)[ \t]*$/;

/** The `## key` sections of a text, each trimmed. Text before the first heading is a note for editors, never sent. */
export function taskSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  let key: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (key !== null && !sections.has(key)) sections.set(key, lines.join("\n").trim());
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      key = heading[1]!;
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

/** The `## key` section of a text; null when it has none or it is empty. */
export function taskSection(text: string, key: string): string | null {
  return taskSections(text).get(key) || null;
}

const SLOT = /\{\{\s*([\p{L}\p{N}_-]+)\s*\}\}/gu;

/** The `{{slot}}` names a text holds. */
export const slotsIn = (text: string): string[] => [...new Set([...text.matchAll(SLOT)].map((match) => match[1]!))];

/** The text with each `{{slot}}` replaced by its value; a slot without a value is left out. */
export const fillSlots = (text: string, values: Record<string, string>): string => text.replace(SLOT, (_, name: string) => values[name] ?? "");

/**
 * What a text lacks to be used for `seed`'s task: each missing section as `## key`, each missing slot as
 * `{{slot}}` (with its section), and "length" when it is longer than the task allows. Empty when usable.
 */
export function taskInstructionsProblems(seed: TaskPlaybookSeed, text: string): string[] {
  const problems: string[] = [];
  if (seed.maxLength !== undefined && text.length > seed.maxLength) problems.push("length");
  if (seed.sections) {
    const sections = taskSections(text);
    for (const section of seed.sections) {
      const body = sections.get(section.key);
      if (!body) {
        problems.push(`## ${section.key}`);
        continue;
      }
      const held = slotsIn(body);
      for (const slot of section.slots ?? []) if (!held.includes(slot)) problems.push(`## ${section.key} : {{${slot}}}`);
    }
  } else {
    const held = slotsIn(text);
    for (const slot of seed.slots ?? []) if (!held.includes(slot)) problems.push(`{{${slot}}}`);
  }
  return problems;
}

/**
 * Whether a version's `text` runs on the task's Playbook Agent: never for a task without one, and not for a
 * version lacking the section its agent reads (company-facts-search's version 1, the search alone, #405).
 */
export function runsOnAgent(id: TaskPlaybookId, text: string): boolean {
  const seed: TaskPlaybookSeed = taskPlaybookSeed(id)!;
  if (!seed.agent) return false;
  return (seed.sections ?? []).every((section) => !section.agent || taskSection(text, section.key) !== null);
}

/**
 * The built-in text of a task, or of one of its sections: version 1 as written in this repo. Throws for
 * an id or section the code does not know (a programming error).
 */
export function builtInInstructions(id: TaskPlaybookId, section?: string): string {
  const seed = taskPlaybookSeed(id)!;
  if (section === undefined) return seed.instructions;
  const text = taskSection(seed.instructions, section);
  if (text === null) throw new Error(`Task Playbook "${id}" has no section "${section}"`);
  return text;
}
