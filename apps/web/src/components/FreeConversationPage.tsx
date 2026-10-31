import { CoachConversationPage } from "@/components/CoachPanel";
import { QuickActions } from "@/components/QuickActions";
import { Note } from "@/design/Note";
import { getServerT } from "@/i18n/server";

/**
 * A Free conversation as its page (#601, ADR-0070), under « Conversation au centre »: the home page's new one
 * (`conversationId` null) or a saved one. Its first message holds the Introduction (the AI disclosure, the tagline, what
 * Jobbbox does, and the note that it is being built); the Quick actions are the suggestions above the box until the
 * first message is sent. Keyed by the conversation, so another one starts its page afresh.
 */
export async function FreeConversationPage({ conversationId }: { conversationId: string | null }) {
  const t = await getServerT();
  return (
    <CoachConversationPage
      key={conversationId ?? "new"}
      conversationId={conversationId}
      introduction={
        <>
          <p>{t("app.tagline")}</p>
          <p>{t("home.intro")}</p>
          <Note>{t("home.comingSoon")}</Note>
        </>
      }
      suggestions={<QuickActions />}
    />
  );
}
