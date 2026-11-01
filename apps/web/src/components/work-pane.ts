"use client";

import { createContext, useContext } from "react";
import type { HelpArticle } from "@/coach-help";
import type { SignalementStart } from "@/components/Signalement";

/**
 * What opens in the Work Pane (#602, ADR-0070), one at a time: a Help Article (an Article card), a Signalement's form
 * (`start`, as the Drawer took it), the Coach Memory, or an object's Section or Result (#603), shown at its own address
 * (`href`) under its `title` (see InWorkPane). Other forms join with their own issues.
 */
export type WorkPaneItem =
  | { kind: "help"; article: HelpArticle }
  | { kind: "signalement"; start: SignalementStart }
  | { kind: "memory" }
  | { kind: AddressedKind; title: string; href: string };

/** What opens in the Work Pane at its own address: an object's Section or Result (#603). */
export type AddressedKind = "section" | "result";

/**
 * The Work Pane of the Candidate's pages under « Conversation au centre »: `item`, what it shows (null: closed); `open`
 * shows `item` in its place, the focus on its title, and remembers what had the focus; `close` gives the focus back to it.
 */
export interface WorkPaneControl {
  item: WorkPaneItem | null;
  open: (item: WorkPaneItem) => void;
  close: () => void;
}

export const WorkPaneContext = createContext<WorkPaneControl | null>(null);

/** The Work Pane, or null where there is none (« Conversation au centre » off, the Back Office, signed-out pages). */
export function useWorkPane(): WorkPaneControl | null {
  return useContext(WorkPaneContext);
}

/** The address's parameter naming the Help Article a new Free conversation is asked about (« Demander au coach »). */
const ASK_ABOUT = "aide";

/** The home page, a new Free conversation, asked about the Help Article `articleId`: « Demander au coach » off a conversation. */
export function askCoachAddress(articleId: string): string {
  return `/?${new URLSearchParams({ [ASK_ABOUT]: articleId })}`;
}

/** The Help Article an address's query (`location.search`) asks the conversation about, or null. */
export function askedAbout(search: string): string | null {
  return new URLSearchParams(search).get(ASK_ABOUT) || null;
}
