import { useRouter, usePathname } from "expo-router";
import { CircleUser, ClipboardList, Settings, SquarePen, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useOffersToHandle } from "../api/reads";
import { space, useTheme } from "../theme/theme";
import { ObjectRow, type RowAction } from "../ui/ObjectRow";
import { FreeConversations } from "./FreeConversations";
import { isCurrent, MENUS, NEW_CONVERSATION, paths } from "./pages";

/**
 * The Sidebar (ADR-0076): « Nouvelle conversation », the menus, « Coach » with the Free conversations, then at its foot
 * « Espace coach » for a Human Coach, Mon compte and Réglages de l'app. As a drawer or a column, as the shell decides.
 * « Recherches d'offres » carries « N », the Offer box's offers à traiter (#818, ADR-0090); nothing at 0.
 */
export function Sidebar({ isHumanCoach = false, isAssociationMember=false,onNavigate }: { isHumanCoach?: boolean;isAssociationMember?:boolean; onNavigate: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const toHandle = useOffersToHandle().data?.toHandle ?? 0;
  const go = (path: string) => {
    onNavigate();
    router.navigate(path);
  };
  const entry = (path: string, label: string, icon: LucideIcon, actions: readonly RowAction[] = [], count?: { value: number; label: string }) => (
    <ObjectRow key={path} label={label} icon={icon} current={isCurrent(pathname, path)} onPress={() => go(path)} actions={actions} count={count} />
  );

  return (
    <View role="navigation" aria-label={t("sidebar.label")} style={{ gap: space[4] }}>
      <View>
        {entry(paths.conversation(NEW_CONVERSATION), t("conversationFirst.newConversation"), SquarePen)}
        {MENUS.map((menu) =>
          entry(menu.path, t(menu.label), menu.icon, [], menu.key === "jobSearches" ? { value: toHandle, label: t("conversationFirst.offersToHandle", { count: toHandle }) } : undefined),
        )}
      </View>
      <FreeConversations onNavigate={onNavigate} />
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[2] }}>
        {isHumanCoach ? entry(paths.coachSpace, t("account.coachSpace"), ClipboardList) : null}
        {isAssociationMember?entry(paths.associationSpace,t("association.title"),ClipboardList):null}
        {entry(paths.account, t("nav.account"), CircleUser)}
        {entry(paths.appSettings, t("mobile.appSettings"), Settings)}
      </View>
    </View>
  );
}
