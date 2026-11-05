import { useRouter, usePathname } from "expo-router";
import { CircleUser, ClipboardList, MessageSquare, Settings, SquarePen, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { SAMPLE_FREE_CONVERSATIONS } from "../sample-data";
import { space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { ObjectRow, type RowAction } from "../ui/ObjectRow";
import { shareLinkAction } from "./links";
import { isCurrent, MENUS, NEW_CONVERSATION, paths } from "./pages";

/**
 * The Sidebar (ADR-0076): « Nouvelle conversation », the menus, « Coach » with the Free conversations, then at its foot
 * « Espace coach » for a Human Coach, Mon compte and Réglages de l'app. As a drawer or a column, as the shell decides.
 */
export function Sidebar({ isHumanCoach = false, onNavigate }: { isHumanCoach?: boolean; onNavigate: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const go = (path: string) => {
    onNavigate();
    router.navigate(path);
  };
  const entry = (path: string, label: string, icon: LucideIcon, actions: readonly RowAction[] = []) => (
    <ObjectRow key={path} label={label} icon={icon} current={isCurrent(pathname, path)} onPress={() => go(path)} actions={actions} />
  );
  // A Free conversation's context menu (#700); « Renommer » and « Supprimer » come with the conversations' API (#690).
  const conversationActions = (path: string): RowAction[] => [
    { label: t("mobile.rowMenu.open"), onPress: () => go(path) },
    shareLinkAction(t("mobile.rowMenu.shareLink"), path),
  ];

  return (
    <View role="navigation" aria-label={t("sidebar.label")} style={{ gap: space[4] }}>
      <View>
        {entry(paths.conversation(NEW_CONVERSATION), t("conversationFirst.newConversation"), SquarePen)}
        {MENUS.map((menu) => entry(menu.path, t(menu.label), menu.icon))}
      </View>
      <View>
        <View style={{ paddingHorizontal: space[3], paddingVertical: space[1] }}>
          <AppText variant="meta" tone="meta" weight="semiBold">
            {t("conversationFirst.coach")}
          </AppText>
        </View>
        {SAMPLE_FREE_CONVERSATIONS.map((conversation) => {
          const path = paths.conversation(conversation.id);
          return entry(path, conversation.title, MessageSquare, conversationActions(path));
        })}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[2] }}>
        {isHumanCoach ? entry(paths.coachSpace, t("account.coachSpace"), ClipboardList) : null}
        {entry(paths.account, t("nav.account"), CircleUser)}
        {entry(paths.appSettings, t("mobile.appSettings"), Settings)}
      </View>
    </View>
  );
}
