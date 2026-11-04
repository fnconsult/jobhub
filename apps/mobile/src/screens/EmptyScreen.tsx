import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";

/** A page the app does not draw yet: its title is the Top Bar's; below, that it is coming. */
export function EmptyScreen({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: space[4], padding: space[4] }}>
      <AppText tone="secondary" centered>
        {t("mobile.emptyScreen")}
      </AppText>
      {children}
    </View>
  );
}
