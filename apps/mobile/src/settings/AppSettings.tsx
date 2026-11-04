import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Switch, View } from "react-native";
import { useAppLock } from "../app-lock/AppLock";
import { space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";

/**
 * Réglages de l'app: what belongs to this device and not to the account (Mon compte is the account's, on the server).
 * For now « Verrouiller l'app », the optional lock by Face ID or fingerprint (ADR-0076).
 */
export function AppSettings() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lock = useAppLock();
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const change = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) setUnavailable((await lock.turnOn()) === "unavailable");
      else await lock.turnOff();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[2] }}>
      <View style={{ minHeight: TARGET, flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <View style={{ flex: 1 }}>
          <AppText weight="semiBold">{t("mobile.appLock.setting")}</AppText>
        </View>
        <Switch
          role="switch"
          aria-label={t("mobile.appLock.setting")}
          aria-checked={lock.on}
          value={lock.on}
          disabled={busy}
          onValueChange={(on) => void change(on)}
          trackColor={{ true: colors.accent, false: colors.borderStrong }}
        />
      </View>
      <AppText tone="secondary">{t("mobile.appLock.hint")}</AppText>
      {unavailable ? (
        <View role="alert">
          <AppText tone="danger">{t("mobile.appLock.unavailable")}</AppText>
        </View>
      ) : null}
    </ScrollView>
  );
}
