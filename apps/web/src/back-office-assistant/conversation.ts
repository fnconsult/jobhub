/**
 * The Back Office Assistant's conversation window: it answers from the most recent
 * messages, however long a conversation has grown. No server-only imports: the
 * panel and the worker (which purges the conversations) bundle it.
 */

import type { Provenance } from "@jobhub/shared";

/** One message of a conversation with the Back Office Assistant. */
export interface AssistantMessage {
  from: "administrator" | "assistant";
  text: string;
  /** On a saved reply: what served it (#327), a partial one for a reply saved before, or null when nothing was kept. */
  provenance?: Provenance | null;
  /** On a saved reply: when it was saved, an ISO date. */
  at?: string;
  /** A Blocked message (#228): a question a Guardrail stopped, or the Guardrail message answering it or replacing a reply. */
  blocked?: true;
  /** On an Administrator's message asked from an Explainable label (#407): the item it asks about, in context. */
  explained?: ExplainedItem;
}

/**
 * What an Explainable label explains (#407): a setting, a source, a warning, a page's intro, a Dashboard figure, a run's
 * stop reason, or one of Email intake's Recognised senders, listed or proposed (#448).
 */
export const EXPLAINED_KINDS = ["setting", "source", "warning", "intro", "figure", "stop_reason", "recognised_sender"] as const;
export type ExplainedKind = (typeof EXPLAINED_KINDS)[number];

/**
 * The item an Explainable label asks the Back Office Assistant to explain, as the Administrator sees it there, in their
 * language: never a Provider Secret's value nor an email address (the assistant drops them anyway).
 */
export interface ExplainedItem {
  /** The label's words, or what a « Pourquoi ? » explains (the warning). */
  label: string;
  /** The Back Office page, by its path. */
  page: string;
  /** The page's tab, by its name. */
  tab?: string;
  kind: ExplainedKind;
  /** The item in code: a setting's or a source's name, a figure's key. */
  id: string;
  /** Its value in use, where it comes from and its state (available, why not), as the page shows them. */
  value?: string;
  source?: string;
  state?: string;
}

/** Longest text of an explained item's field. */
export const MAX_EXPLAINED_LENGTH = 1000;

/** Longest single message, and most messages the assistant answers from. */
export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_MESSAGES = 40;

/** The last MAX_MESSAGES messages, starting with an Administrator's message. */
export function recentMessages<T extends AssistantMessage>(messages: readonly T[]): T[] {
  const recent = messages.slice(-MAX_MESSAGES);
  const start = recent.findIndex((message) => message.from === "administrator");
  return start === -1 ? [] : recent.slice(start);
}
