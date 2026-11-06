import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ApplicationSection, isAppSection } from "../../../applications/ApplicationSections";
import { CoachConversation } from "../../../coach/CoachConversation";
import type { SubjectRef } from "../../../coach/coach-reply";
import { paths } from "../../../navigation/pages";
import { useWorkPane } from "../../../shell/Shell";

const APPLICATION: SubjectRef["kind"] = "application";

/**
 * One of an Application's Sections, at the web's address (`/candidatures/:id/entretiens`): the Application's
 * conversation (its Subject, ADR-0070, as at `/candidatures/:id`) with that Section open in the Work Pane (#691); the
 * Agenda's Interviews lead here. A Section the app does not show opens the Application's page alone.
 */
export default function ApplicationSectionPage() {
  const { id, section } = useLocalSearchParams<{ id: string; section: string }>();
  const { t } = useTranslation();
  const workPane = useWorkPane();
  const shown = isAppSection(section) ? section : null;
  useEffect(() => {
    if (!shown) return;
    workPane.open({ title: t(`application.sections.${shown}`), content: <ApplicationSection applicationId={id} section={shown} /> });
  }, [id, shown, workPane, t]);
  return <CoachConversation key={id} conversationId={null} subject={{ kind: APPLICATION, id }} route={shown ? paths.applicationSection(id, shown) : paths.application(id)} />;
}
