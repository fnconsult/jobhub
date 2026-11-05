import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { INTERVIEWS } from "../../../navigation/pages";
import { SampleConversation } from "../../../conversation/SampleConversation";
import { useWorkPane } from "../../../shell/Shell";
import { AppText } from "../../../ui/AppText";

/**
 * One of an Application's Sections, at the web's address (`/candidatures/:id/entretiens`): the Application's
 * conversation with that Section open in the Work Pane. Its content is #691's; the Agenda's Interviews lead here.
 */
export default function ApplicationSection() {
  const { id, section } = useLocalSearchParams<{ id: string; section: string }>();
  const { t } = useTranslation();
  const workPane = useWorkPane();
  useEffect(() => {
    if (section !== INTERVIEWS) return;
    workPane.open({ title: t("application.sections.entretiens"), content: <AppText tone="secondary">{t("mobile.workPanePlaceholder")}</AppText> });
  }, [section, workPane, t]);
  return <SampleConversation key={id} />;
}
