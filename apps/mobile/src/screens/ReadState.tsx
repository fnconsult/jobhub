import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, View } from "react-native";
import { ReadFailed, type Read } from "../api/reads";
import { useOnline } from "../offline/read-cache";
import { space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

/**
 * What a read shows (#695): its data once read, the last seen while offline when the device has it; until then
 * « Chargement… »; without network, that it loads once the network returns (the « Hors ligne » banner says the rest,
 * #701), which it then does by itself; `notFound` for what is not the Candidate's (404); a 401, the session ended on
 * the web app (the read has the session checked, which takes the app back to sign-in), said without « Réessayer »; any other failure, said, with « Réessayer ».
 */
export function ReadState<T>({ read, notFound, children }: { read: Read<T>; notFound?: string; children: (data: T) => ReactNode }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const online = useOnline();
  const status = read.error instanceof ReadFailed ? read.error.status : null;
  if (read.data !== undefined) return <>{children(read.data)}</>;
  if (!online) return <AppText tone="secondary">{t("mobile.reads.offline")}</AppText>;
  if (read.isError) {
    if (status === 404 && notFound) return <AppText tone="secondary">{notFound}</AppText>;
    if (status === 401) return <AppText tone="secondary">{t("mobile.reads.failed")}</AppText>;
    return (
      <View style={{ gap: space[2] }}>
        <AppText tone="danger">{t("mobile.reads.failed")}</AppText>
        <Control label={t("mobile.reads.retry")} look="secondary" onPress={() => void read.refetch()} />
      </View>
    );
  }
  return (
    <View role="progressbar" aria-busy style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
      <ActivityIndicator color={colors.secondary} />
      <AppText tone="secondary">{t("mobile.reads.loading")}</AppText>
    </View>
  );
}
