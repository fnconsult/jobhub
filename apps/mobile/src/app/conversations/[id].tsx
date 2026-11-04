import { useLocalSearchParams } from "expo-router";
import { SampleConversation } from "../../conversation/SampleConversation";

/** A Free conversation, or a new one (« Nouvelle conversation »). */
export default function FreeConversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SampleConversation key={id} />;
}
