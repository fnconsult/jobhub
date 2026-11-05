import { useRouter } from "expo-router";
import { CircleUser, CreditCard, Database, LogOut, ScrollText, ShieldCheck, Trash2, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { paths } from "../../navigation/pages";
import { useSession } from "../../session/SessionGate";
import { space, useTheme } from "../../theme/theme";
import { AppText } from "../../ui/AppText";
import { Control } from "../../ui/Control";

/**
 * Mon compte (#689, ADR-0076): the account's pages are the web app's, opened inside the app with the session (its
 * sections, Sécurité and the second step's factors, Mes données with the Data export, the subscription, the Legal
 * Texts), « Supprimer mon compte » one gesture away (App Store guideline 5.1.1(v)); signing out is the app's own (#685).
 */
export default function Account() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { signOut } = useSession();
  const router = useRouter();
  const row = (label: string, icon: LucideIcon, path: string) => <Control key={path} label={label} icon={icon} onPress={() => router.navigate(path)} />;
  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4] }}>
      <AppText tone="secondary">{t("mobile.account.intro")}</AppText>
      <View>
        {row(t("mobile.account.allSections"), CircleUser, paths.accountSections)}
        {row(t("account.sections.security"), ShieldCheck, paths.accountSecurity)}
        {row(t("account.sections.data"), Database, paths.accountData)}
        {row(t("account.plan"), CreditCard, paths.subscription)}
        {row(t("legal.documentsNav"), ScrollText, paths.legal)}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[2] }}>
        {row(t("accountData.deleteTitle"), Trash2, paths.accountDeletion)}
        <Control icon={LogOut} label={t("account.signOut")} onPress={() => void signOut()} />
      </View>
    </ScrollView>
  );
}
