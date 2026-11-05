import { WifiOff } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { space, radius, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { useOnline } from "./read-cache";

/** Read out when it appears and goes, without interrupting what is being read. */
const ANNOUNCED = "polite" as const;

/** « Hors ligne », above the page while the device has no network: what it shows was loaded earlier, and nothing is saved (#701). */
export function OfflineBanner() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (useOnline()) return null;
  return (
    <View
      role="status"
      aria-live={ANNOUNCED}
      style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start", marginHorizontal: space[2], marginBottom: space[1], padding: space[3], borderRadius: radius.card, backgroundColor: colors.warnSoft }}
    >
      <WifiOff color={colors.text} size={20} aria-hidden />
      <View style={{ flex: 1 }}>
        <AppText weight="semiBold">{t("mobile.offline.banner")}</AppText>
        <AppText variant="meta" tone="meta">
          {t("mobile.offline.bannerDetail")}
        </AppText>
      </View>
    </View>
  );
}
