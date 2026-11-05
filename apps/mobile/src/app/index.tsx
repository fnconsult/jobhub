import { useRouter } from "expo-router";
import { CoachConversation } from "../coach/CoachConversation";
import { paths } from "../navigation/pages";

/** The home page: a new Free conversation (ADR-0070); its first message saved, the page takes the conversation's address. */
export default function Home() {
  const router = useRouter();
  return <CoachConversation conversationId={null} route={paths.home} onSaved={(saved) => router.replace(paths.conversation(saved.id))} />;
}
