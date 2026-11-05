import { useLocalSearchParams, useRouter } from "expo-router";
import { CoachConversation } from "../../coach/CoachConversation";
import { NEW_CONVERSATION, paths } from "../../navigation/pages";

/** A Free conversation, or a new one (« Nouvelle conversation »), whose first message saved gives it its address. */
export default function FreeConversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const saved = id === NEW_CONVERSATION ? null : id;
  return (
    <CoachConversation
      key={id}
      conversationId={saved}
      route={paths.conversation(id)}
      onSaved={(conversation) => router.replace(paths.conversation(conversation.id))}
    />
  );
}
