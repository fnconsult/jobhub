import { LogOut } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { EmptyScreen } from "../screens/EmptyScreen";
import { useSession } from "../session/SessionGate";
import { Control } from "../ui/Control";

/** Mon compte (a WebView, ADR-0076): to come; signing out is the app's own (#685). */
export default function Account() {
  const { t } = useTranslation();
  const { signOut } = useSession();
  return (
    <EmptyScreen>
      <Control look="secondary" icon={LogOut} label={t("account.signOut")} onPress={() => void signOut()} />
    </EmptyScreen>
  );
}
