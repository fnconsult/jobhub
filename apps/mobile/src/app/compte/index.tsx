import type { ProfilesResponse } from "@jobhub/shared/reads";
import { useRouter } from "expo-router";
import { ChevronRight, CircleUser, CreditCard, Database, LogOut, ScrollText, ShieldCheck, Trash2, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { useProfiles } from "../../api/reads";
import { paths } from "../../navigation/pages";
import { ReadState } from "../../screens/ReadState";
import { useSession } from "../../session/SessionGate";
import { radius, space, TARGET, useTheme } from "../../theme/theme";
import { AppText } from "../../ui/AppText";
import { Control } from "../../ui/Control";

/**
 * Mon compte: its first Section, the Profiles, native and to read (#695), each leading to its page. They are the
 * Candidate's own, read from `GET /api/profiles`, which leaves the Archived Profiles out. The account's other pages are
 * the web app's, opened inside the app with the session (#689, ADR-0076: its sections, Sécurité and the second step's
 * factors, Mes données with the Data export, the subscription, the Legal Texts), « Supprimer mon compte » one gesture
 * away (App Store guideline 5.1.1(v)); signing out is the app's own (#685).
 */
export default function Account() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { signOut } = useSession();
  const router = useRouter();
  const profiles = useProfiles();
  const row = (label: string, icon: LucideIcon, path: string) => <Control key={path} label={label} icon={icon} onPress={() => router.navigate(path)} />;
  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4] }}>
      <AppText variant="h2">{t("account.sections.profiles")}</AppText>
      <View style={{ gap: space[2] }}>
        <ReadState read={profiles}>{(list) => <ProfileLinks profiles={list} />}</ReadState>
      </View>
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

function ProfileLinks({ profiles }: { profiles: ProfilesResponse }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  if (profiles.length === 0) return <AppText tone="secondary">{t("mobile.profiles.none")}</AppText>;
  return profiles.map((profile) => (
    <Pressable
      key={profile.id}
      role="link"
      aria-label={profile.name}
      onPress={() => router.navigate(paths.profile(profile.id))}
      style={({ pressed }) => ({
        minHeight: TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        padding: space[3],
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.hover : "transparent",
      })}
    >
      <View style={{ flex: 1 }}>
        <AppText weight="semiBold">{profile.name}</AppText>
      </View>
      <ChevronRight color={colors.secondary} size={20} aria-hidden />
    </Pressable>
  ));
}
