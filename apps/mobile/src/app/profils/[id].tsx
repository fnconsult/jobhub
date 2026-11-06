import { useLocalSearchParams } from "expo-router";
import { CoachConversation } from "../../coach/CoachConversation";
import type { SubjectRef } from "../../coach/coach-reply";
import { paths } from "../../navigation/pages";

const PROFILE: SubjectRef["kind"] = "profile";

/** A Profile's conversation, its Subject (ADR-0070); its Fiche, the Profile to read, beside it or full page, from the Top Bar. */
export default function ProfileConversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CoachConversation key={id} conversationId={null} subject={{ kind: PROFILE, id }} route={paths.profile(id)} />;
}
