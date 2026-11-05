import { useLocalSearchParams } from "expo-router";
import { SampleConversation } from "../../conversation/SampleConversation";

/** A Profile's conversation; its Fiche, the Profile to read, beside it or full page, from the Top Bar. */
export default function ProfileConversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SampleConversation key={id} />;
}
