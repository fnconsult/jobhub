import { useRouter, usePathname } from "expo-router";
import { CircleUser, ClipboardList, MessageSquare, SquarePen, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { SAMPLE_FREE_CONVERSATIONS } from "../sample-data";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { isCurrent, MENUS, NEW_CONVERSATION, paths } from "./pages";

/**
 * The Sidebar (ADR-0076): « Nouvelle conversation », the menus, « Coach » with the Free conversations, then at its foot
 * « Espace coach » for a Human Coach and Mon compte. As a drawer or a column, as the shell decides.
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
  const entry = (path: string, label: string, icon: LucideIcon) => (
    <Entry key={path} label={label} icon={icon} current={isCurrent(pathname, path)} onPress={() => go(path)} />
  );

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
        {SAMPLE_FREE_CONVERSATIONS.map((conversation) => entry(paths.conversation(conversation.id), conversation.title, MessageSquare))}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[2] }}>
        {isHumanCoach ? entry(paths.coachSpace, t("account.coachSpace"), ClipboardList) : null}
        {entry(paths.account, t("nav.account"), CircleUser)}
      </View>
    </View>
  );
}

function Entry({ label, icon: Icon, current, onPress }: { label: string; icon: LucideIcon; current: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      role="link"
      aria-label={label}
      aria-selected={current}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[3],
        borderRadius: radius.md,
        backgroundColor: current || pressed ? colors.hover : "transparent",
      })}
    >
      <Icon color={current ? colors.accent : colors.secondary} size={20} aria-hidden />
      <View style={{ flex: 1 }}>
        <AppText weight={current ? "semiBold" : "regular"} lines={2}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}
