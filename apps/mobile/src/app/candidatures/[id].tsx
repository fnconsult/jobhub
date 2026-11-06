import { useLocalSearchParams } from "expo-router";
import { CoachConversation } from "../../coach/CoachConversation";
import type { SubjectRef } from "../../coach/coach-reply";
import { paths } from "../../navigation/pages";

const APPLICATION: SubjectRef["kind"] = "application";

/** An Application's conversation, its Subject (ADR-0070); its Fiche beside it or full page, from the Top Bar. */
export default function ApplicationConversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CoachConversation key={id} conversationId={null} subject={{ kind: APPLICATION, id }} route={paths.application(id)} />;
}
