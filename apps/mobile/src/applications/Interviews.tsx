import type { ApplicationResponse, InterviewRead } from "@jobhub/shared/reads";
import { useRouter } from "expo-router";
import { CalendarDays } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, View } from "react-native";
import { paths } from "../navigation/pages";
import { useOnline } from "../offline/read-cache";
import { useAskForPush } from "../push/PushNotifications";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { FieldError } from "../ui/TextField";
import { useApplicationWrites, type ApplicationWrites } from "./application-writes";
import { applicationFormats, type ApplicationFormats } from "./application-formats";
import { draftOf } from "./interview-draft";
import { InterviewForm } from "./InterviewForm";

/** Without a duration, an Interview is shown to last an hour (apps/web/src/applications, INTERVIEW_DEFAULT_DURATION_MINUTES). */
const DEFAULT_DURATION_MINUTES = 60;

/** « jeudi 12 novembre 2026, 14:30 – 15:15 »: an Interview's day, and when it starts and ends, in French time. */
function when(interview: InterviewRead, formats: ApplicationFormats): string {
  const endsAt = new Date(new Date(interview.scheduledAt).getTime() + (interview.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000).toISOString();
  return `${formats.fullDate(interview.scheduledAt)}, ${formats.time(interview.scheduledAt)} – ${formats.time(endsAt)}`;
}

/**
 * The Application's Interviews Section (#691), as the web's: each Interview changed (moved to another date, a
 * Reschedule), Cancelled or removed in place, through the web's routes; a Cancelled one stays, struck through, with its
 * date of cancellation; a Rescheduled one says when it was first planned. A form adds one while the Application is at
 * « Entretien ». « Voir dans l'agenda » leads to the Agenda. Nothing is written offline (ADR-0076). Once the web app
 * has added an Interview, the app asks for Push notifications in context (#699): a refused add asks nothing.
 */
export function Interviews({ application }: { application: ApplicationResponse }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const writes = useApplicationWrites(application.id);
  const askForPush = useAskForPush();
  const askAfterAdding = () => askForPush("interview");
  const formats = applicationFormats(i18n.language);
  const { interviews } = application;
  const atInterview = application.status === "interview";
  return (
    <View style={{ gap: space[4] }}>
      <View style={{ alignItems: "flex-start" }}>
        <Control label={t("application.seeInAgenda")} icon={CalendarDays} look="secondary" onPress={() => router.navigate(paths.agenda)} />
      </View>
      {interviews.length === 0 ? (
        <View style={{ gap: space[1] }}>
          <AppText weight="semiBold">{t("application.interviewsNone")}</AppText>
          {atInterview ? null : <AppText tone="secondary">{t("application.interviewsHint")}</AppText>}
        </View>
      ) : (
        <>
          {interviews.map((interview) => (
            <InterviewItem key={interview.id} interview={interview} writes={writes} formats={formats} />
          ))}
          <AppText variant="meta" tone="meta">
            {t("agendaChanges.removeHint")}
          </AppText>
        </>
      )}
      {atInterview ? (
        <View style={{ gap: space[3] }}>
          <AppText variant="h3" heading>
            {t("application.addInterview")}
          </AppText>
          <InterviewForm save={writes.addInterview} onSaved={askAfterAdding} />
        </View>
      ) : interviews.length > 0 ? (
        <AppText tone="secondary">{t("application.interviewsHint")}</AppText>
      ) : null}
    </View>
  );
}

/** One Interview: when, how and where, its note, its Reschedule or cancellation, and what can be done with it. */
function InterviewItem({ interview, writes, formats }: { interview: InterviewRead; writes: ApplicationWrites; formats: ApplicationFormats }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const online = useOnline();
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancelled = interview.cancelledAt !== null;
  const named = formats.dateTime(interview.scheduledAt);
  const facts = [interview.format ? t(`interviewFormats.${interview.format}`) : null, interview.place || null].filter(Boolean).join(" · ");
  const firstPlanned = interview.reschedules[0]?.previousAt;

  const done = (outcome: { ok: boolean }) => setFailed(!outcome.ok);
  const cancel = () =>
    Alert.alert(t("agendaChanges.cancelInterview"), t("agendaChanges.cancelInterviewConfirm"), [
      { text: t("agendaChanges.keep"), style: "cancel" },
      { text: t("agendaChanges.confirm"), style: "destructive", onPress: () => void writes.cancelInterview(interview.id).then(done) },
    ]);

  return (
    <View style={{ gap: space[2], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
      <AppText weight="semiBold" struck={cancelled}>
        {when(interview, formats)}
      </AppText>
      {interview.cancelledAt ? <AppText tone="danger">{t("agendaChanges.cancelledOn", { date: formats.date(interview.cancelledAt) })}</AppText> : null}
      {facts ? <AppText tone="secondary">{facts}</AppText> : null}
      {interview.note ? <AppText>{interview.note}</AppText> : null}
      {firstPlanned ? <AppText tone="warn">{t("agendaChanges.rescheduled", { date: formats.changedAt(firstPlanned) })}</AppText> : null}
      {editing ? (
        <InterviewForm interview={draftOf(interview)} save={(draft) => writes.changeInterview(interview.id, draft)} onClose={() => setEditing(false)} />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          <Control label={t("application.editInterview", { date: named })} look="secondary" disabled={!online} onPress={() => setEditing(true)} />
          {cancelled ? null : (
            <Control label={t("agendaChanges.cancelInterview")} accessibleName={t("agendaChanges.cancelInterviewFor", { date: named })} look="secondary" disabled={!online} onPress={cancel} />
          )}
          <Control label={t("application.removeInterview", { date: named })} disabled={!online} onPress={() => void writes.removeInterview(interview.id).then(done)} />
        </View>
      )}
      {failed ? <FieldError message={t("application.error")} /> : null}
    </View>
  );
}
