import { useTranslation } from "react-i18next";
import { Linking, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";

/**
 * « Mettre à jour Jobbbox » (#704): the whole screen, in place of the app, once the platform answered 426 to this build.
 * Its one action opens the store page where the person updates.
 */
export function UpdateRequired({ storeUrl }: { storeUrl: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const open = Platform.OS === "android" ? t("mobile.update.openPlayStore") : t("mobile.update.openAppStore");
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        gap: space[4],
        padding: space[6],
        paddingTop: insets.top + space[6],
        paddingBottom: insets.bottom + space[6],
        backgroundColor: colors.background,
      }}
    >
      <View accessible role="heading" aria-label={t("mobile.update.title")}>
        <AppText variant="h1" centered>
          {t("mobile.update.title")}
        </AppText>
      </View>
      <AppText tone="secondary" centered>
        {t("mobile.update.body")}
      </AppText>
      <Pressable
        role="link"
        aria-label={open}
        onPress={() => void Linking.openURL(storeUrl)}
        style={({ pressed }) => ({
          minHeight: TARGET,
          justifyContent: "center",
          paddingHorizontal: space[4],
          borderRadius: radius.control,
          backgroundColor: pressed ? colors.accentHover : colors.accent,
        })}
      >
        <AppText weight="semiBold" tone="onAccent">
          {open}
        </AppText>
      </Pressable>
    </View>
  );
}
