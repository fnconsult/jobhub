/** One `## key` section a task Playbook's text must have: the code picks one per call (a language, a channel). */
export interface TaskPlaybookSection {
  key: string;
  /** What it is for, in French, shown in the Back Office. */
  label: string;
  /** The `{{slot}}` it must hold, where the code puts a value in (cleaned, never personal data). */
  slots?: readonly string[];
}

/**
 * A task Playbook as written in this repo (ADR-0026): its id, French title, and the text imported as its
 * version 1. The code reads the same text when no version is served, so the two cannot drift.
 */
export interface TaskPlaybookSeed {
  /** Short and stable: the code reads it by this id. */
  id: string;
  /** In French, shown in the Back Office. */
  title: string;
  /** The AI task its calls are counted under in AI Usage. */
  aiTask: string;
  /**
   * Whether it runs on its Playbook Agent (a text model offered for it). False for a web-search query,
   * which always goes to the configured web-search provider: it has no Playbook Agent.
   */
  agent: boolean;
  /** Imported Human-validated (by François Nader, ADR-0026), so production kept running it. */
  validatedAtImport: boolean;
  /** The sections its text must have; none: the whole text is the instructions. */
  sections?: readonly TaskPlaybookSection[];
  /** The `{{slot}}` its whole text must hold, when it has no sections. */
  slots?: readonly string[];
  /** Longest text, in characters, when it goes into a web-search query. */
  maxLength?: number;
  /** Version 1: the instructions, in Markdown. */
  instructions: string;
}
