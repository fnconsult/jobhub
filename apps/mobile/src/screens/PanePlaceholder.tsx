import { useTranslation } from "react-i18next";
import { View } from "react-native";
import type { PaneKind } from "../shell/disposition";
import { useWorkPane } from "../shell/Shell";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

/** What the Fiche, Activité and the Work Pane will show, said in words until their tickets draw them. */
export function PanePlaceholder({ pane }: { pane: PaneKind | null }) {
  const { t } = useTranslation();
  const workPane = useWorkPane();
  if (pane === null) return null;
  const openSample = () => workPane.open({ title: t("mobile.sampleSection"), content: <AppText tone="secondary">{t("mobile.workPanePlaceholder")}</AppText> });
  return (
    <View style={{ gap: space[4] }}>
      <AppText tone="secondary">{t(pane === "fiche" ? "mobile.fichePlaceholder" : "mobile.activityPlaceholder")}</AppText>
      {pane === "fiche" ? <Control label={t("mobile.openSampleSection")} look="secondary" onPress={openSample} /> : null}
    </View>
  );
}
