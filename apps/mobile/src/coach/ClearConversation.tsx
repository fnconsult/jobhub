import { Eraser } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { Control } from "../ui/Control";
import { usePageConversation } from "./page-conversation";

/** Asks the system's Dialog to confirm « Effacer » (ADR-0070), then clears the page's conversation. */
export function useConfirmClear() {
  const { t } = useTranslation();
  const page = usePageConversation();
  if (!page?.conversationId || page.live) return null;
  return () =>
    Alert.alert(t("conversationFirst.clearTitle"), t("conversationFirst.clearText"), [
      { text: t("coachPanel.cancel"), style: "cancel" },
      {
        text: t("conversationFirst.clear"),
        style: "destructive",
        onPress: () => void page.clear().then((done) => (done ? undefined : Alert.alert(t("coachPanel.listErrors.action")))),
      },
    ]);
}

/**
 * « Effacer » in the Top Bar, on a page whose conversation is saved (ADR-0070): every message deleted once the Dialog
 * confirms, the object and Coach Memory kept. Never while a reply is on its way.
 */
export function ClearConversation() {
  const { t } = useTranslation();
  const confirm = useConfirmClear();
  if (!confirm) return null;
  return <Control label={t("conversationFirst.clear")} icon={Eraser} look="secondary" onPress={confirm} />;
}
