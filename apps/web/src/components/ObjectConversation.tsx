import type { ReactNode } from "react";
import type { ActivityElement } from "@/ai-activity/pane";
import type { SubjectObjectKind } from "@/coach-conversations";
import { getCoachConversations } from "@/coach-conversations/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachConversationPage, type InView } from "@/components/CoachPanel";
import { ConversationSuggestions, type ConversationSuggestion } from "@/components/ConversationSuggestions";
import type { FicheContent } from "@/components/Fiche";
import { conversationFirst } from "@/conversation-first";
import { getPlatformSettingsResolver } from "@/platform-settings/server";

/** Whether an object's page is its conversation (« Conversation au centre », ADR-0070), its Sections and Results in the Work Pane. */
export const pagesAreConversations = () => conversationFirst(getPlatformSettingsResolver().current());

/** The object a page is the conversation of (ADR-0070): an Application, a Profile, a Job Search or a Job Digest. */
export type ObjectSubject = { kind: SubjectObjectKind; id: string };

/** The object's conversation, null before its first message; never fails the page: without it, the page starts one. */
async function savedConversation(candidateId: string, subject: ObjectSubject): Promise<string | null> {
  try {
    const found = await getCoachConversations().ofSubject(candidateId, subject);
    return found.ok ? (found.conversation?.id ?? null) : null;
  } catch (error) {
    console.error(`[coach-conversations] could not read a ${subject.kind}'s conversation`, error);
    return null;
  }
}

/**
 * An object's page under « Conversation au centre » (#603, #605, ADR-0070): its Coach Conversation, whose Subject it is,
 * with its Introduction and its suggestions until its first message; the Fiche beside it (`fiche`: the object's card,
 * its Sections and its Results); and `children`, what its address opens in the Work Pane (a Section, a Result: see
 * InWorkPane), or nothing at the object's own address. `title` heads the page in the Top Bar; `currentProfileId`, the
 * object's Profile, is the one the Profile switcher names.
 */
export async function ObjectConversation({
  candidateId,
  subject,
  inView,
  title,
  currentProfileId,
  aiActivity,
  fiche,
  introduction,
  suggestions,
  children,
}: {
  candidateId: string;
  subject: ObjectSubject;
  inView: InView;
  title: ReactNode;
  currentProfileId?: string;
  aiActivity: readonly ActivityElement[];
  fiche: FicheContent;
  introduction: ReactNode;
  suggestions: readonly ConversationSuggestion[];
  children?: ReactNode;
}) {
  const conversationId = await savedConversation(candidateId, subject);
  return (
    <CandidateLayout candidateId={candidateId} {...(currentProfileId ? { currentProfileId } : {})} title={title} aiActivity={aiActivity} fiche={fiche}>
      <CoachConversationPage
        key={`${subject.kind} ${subject.id}`}
        conversationId={conversationId}
        subject={subject}
        inView={inView}
        introduction={introduction}
        suggestions={<ConversationSuggestions suggestions={suggestions} />}
      />
      {children}
    </CandidateLayout>
  );
}
