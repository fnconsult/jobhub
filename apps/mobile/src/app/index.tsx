import { useRouter } from "expo-router";
import { HomePage } from "../menus/MenuPages";
import { paths } from "../navigation/pages";

/** The home page: a new Free conversation (ADR-0070); its first message saved, the page takes the conversation's address. */
export default function Home() {
  const router = useRouter();
  return <HomePage onSaved={(id) => router.replace(paths.conversation(id))} />;
}
