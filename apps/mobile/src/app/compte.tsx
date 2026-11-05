import type { ProfilesResponse } from "@jobhub/shared/reads";
import { useRouter } from "expo-router";
import { ChevronRight, LogOut } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { useProfiles } from "../api/reads";
import { paths } from "../navigation/pages";
import { ReadState } from "../screens/ReadState";
import { useSession } from "../session/SessionGate";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

/**
 * Mon compte: its first Section, the Profiles, native and to read (#695), each leading to its page; the rest of Mon
 * compte comes in a WebView (ADR-0076, #689). They are the Candidate's own, read from `GET /api/profiles`, which leaves
 * the Archived Profiles out. Signing out is the app's own (#685), kept at the foot of the page.
 */
export default function Account() {
  const { t } = useTranslation();
  const { signOut } = useSession();
  const profiles = useProfiles();
  return (
    <ScrollView contentContainerStyle={{ gap: space[4], padding: space[4] }}>
      <AppText variant="h2">{t("account.sections.profiles")}</AppText>
      <View style={{ gap: space[2] }}>
        <ReadState read={profiles}>
          {(list) => <ProfileLinks profiles={list} />}
        </ReadState>
      </View>
      <AppText tone="secondary">{t("mobile.emptyScreen")}</AppText>
      <Control look="secondary" icon={LogOut} label={t("account.signOut")} onPress={() => void signOut()} />
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
