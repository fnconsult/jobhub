import type { InterviewFormat } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { INTERVIEW_TIME_ZONE } from "../applications";
import { renderEmail, type RenderedEmail } from "../emails";

/** One Agenda Item as the Appointment Reminder lists it: an Interview or a Coaching Session. */
export type ReminderEmailItem = {
  scheduledAt: Date;
  durationMinutes: number | null;
  note: string | null;
} & (
  | { table: "interview"; title: string; employer: string | null; format: InterviewFormat | null; place: string }
  | { table: "coaching_session"; coach: string; videoLink: string | null }
);

/**
 * The Appointment Reminder: the next day's Agenda Items (all on one day, French time), one card each, in time
 * order as given; the button opens the Agenda; the footer links to the Rappels Section, which switches them off.
 */
export function appointmentReminderEmail(
  { items, agendaUrl, settingsUrl }: { items: ReminderEmailItem[]; agendaUrl: string; settingsUrl: string },
  language: Locale,
): RenderedEmail {
  const i18n = createI18n(language);
  const { t } = i18n;
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "full", timeZone: INTERVIEW_TIME_ZONE }).format(items[0]!.scheduledAt);
  const count = items.length;
  const cards = items.map((item) => {
    const at = time.format(item.scheduledAt);
    const details =
      item.table === "interview"
        ? [
            item.employer ? t("appointmentReminder.email.interviewAt", { time: at, title: item.title, employer: item.employer }) : t("appointmentReminder.email.interview", { time: at, title: item.title }),
            item.format ? t("appointmentReminder.email.format", { format: t(`interviewFormats.${item.format}`) }) : null,
            item.place ? t("appointmentReminder.email.place", { place: item.place }) : null,
          ]
        : [t("appointmentReminder.email.coachingSession", { time: at, coach: item.coach }), item.videoLink ? t("appointmentReminder.email.videoLink", { url: item.videoLink }) : null];
    const [title, ...rest] = [
      ...details,
      item.durationMinutes ? t("appointmentReminder.email.duration", { count: item.durationMinutes }) : null,
      item.note ? t("appointmentReminder.email.note", { note: item.note }) : null,
    ].filter((line): line is string => Boolean(line));
    return { card: { title: title!, details: rest } };
  });
  return renderEmail({
    language,
    subject: t("appointmentReminder.email.subject", { count, date }),
    title: t("appointmentReminder.email.title", { count }),
    body: [t("appointmentReminder.email.intro", { count, date }), ...cards, { action: { label: t("appointmentReminder.email.seeAgenda"), url: agendaUrl } }],
    footer: { reason: t("appointmentReminder.email.reason"), link: { label: t("appointmentReminder.email.settings"), url: settingsUrl } },
  });
}
