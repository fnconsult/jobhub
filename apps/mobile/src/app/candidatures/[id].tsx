import { useLocalSearchParams } from "expo-router";
import { SampleConversation } from "../../conversation/SampleConversation";

/** An Application's conversation; its Fiche beside it or full page, from the Top Bar. */
export default function ApplicationConversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SampleConversation key={id} />;
}
