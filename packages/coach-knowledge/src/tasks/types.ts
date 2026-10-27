/** One `## key` section a task Playbook's text must have: the code picks one per call (a language, a channel). */
export interface TaskPlaybookSection {
  key: string;
  /** What it is for, in French, shown in the Back Office. */
  label: string;
  /** The `{{slot}}` it must hold, where the code puts a value in (cleaned, never personal data). */
  slots?: readonly string[];
  /**
   * The rules its Playbook Agent reads, when an earlier version had no agent (#405): a version without this
   * section runs as that one did, without its agent.
   */
  agent?: boolean;
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
   * Whether it runs on its Playbook Agent (a text model offered for it). False for a web-search query
   * alone: it has no Playbook Agent.
   */
  agent: boolean;
  /**
   * Whether it runs web searches, on the web-search provider (and model or depth) its version names among
   * those configured, or the configured `web_search` route when it names none (ADR-0026).
   */
  search: boolean;
  /** Version 1 imported Human-validated (by François Nader, ADR-0026), so production kept running it. */
  validatedAtImport: boolean;
  /** The sections its text must have; none: the whole text is the instructions. */
  sections?: readonly TaskPlaybookSection[];
  /** The `{{slot}}` its whole text must hold, when it has no sections. */
  slots?: readonly string[];
  /** Longest text, in characters, when it goes into a web-search query. */
  maxLength?: number;
  /** The instructions, in Markdown: version 1, or the text that came after it when `firstVersion` is given. */
  instructions: string;
  /**
   * Version 1 as first imported, when the text written here (`instructions`) came after it and changed how
   * the task runs (#405): its text, and whether a Playbook Agent ran it. `instructions` is then imported as a
   * later version, not Human-validated, so production keeps running version 1 until a person validates it
   * (ADR-0026). The code reads `instructions` as its built-in text, and checks edits against its shape.
   */
  firstVersion?: { instructions: string; agent: boolean };
}
