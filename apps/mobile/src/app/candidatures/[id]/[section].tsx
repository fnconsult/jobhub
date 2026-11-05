import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CoachConversation } from "../../../coach/CoachConversation";
import type { SubjectRef } from "../../../coach/coach-reply";
import { INTERVIEWS, paths } from "../../../navigation/pages";
import { useWorkPane } from "../../../shell/Shell";
import { AppText } from "../../../ui/AppText";

const APPLICATION: SubjectRef["kind"] = "application";

/**
 * One of an Application's Sections, at the web's address (`/candidatures/:id/entretiens`): the Application's
 * conversation (its Subject, ADR-0070, as at `/candidatures/:id`) with that Section open in the Work Pane. Its content is #691's; the Agenda's Interviews lead here.
 */
export default function ApplicationSection() {
  const { id, section } = useLocalSearchParams<{
    id: string;
    section: string;
  }>();
  const { t } = useTranslation();
  const workPane = useWorkPane();
  useEffect(() => {
    if (section !== INTERVIEWS) return;
    workPane.open({
      title: t("application.sections.entretiens"),
      content: (
        <AppText tone="secondary">{t("mobile.workPanePlaceholder")}</AppText>
      ),
    });
  }, [section, workPane, t]);
  const route =
    section === INTERVIEWS
      ? paths.applicationSection(id, INTERVIEWS)
      : paths.application(id);
  return (
    <CoachConversation
      key={id}
      conversationId={null}
      subject={{ kind: APPLICATION, id }}
      route={route}
    />
  );
}
