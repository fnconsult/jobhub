import { createI18n } from "@jobhub/shared/i18n";
import { coachingTime } from "@jobhub/shared/coaching-time";
import { renderEmail, type EmailBlock } from "../emails";
import type { PushNotification } from "../push-notifications";
import type { CoachingNotice, NoticeRecipient } from "./index";
export function coachingNoticeEmail(person: NoticeRecipient, notice: CoachingNotice, baseURL: string) {
  const { t } = createI18n(person.locale),
    absolute = (path: string) => new URL(path, baseURL).href;
  const path =
    notice.kind === "daily" || notice.kind === "cancelled"
      ? "/espace-coach/aujourdhui"
      : person.audience === "candidate"
        ? `/coachs/seances/${notice.sessionId}`
        : `/espace-coach/seances/${notice.sessionId}`;
  const body: EmailBlock[] = [t(`coachingNotices.email.${notice.kind}.body`)];
  if (notice.scheduledAt) body.push(coachingTime(notice.scheduledAt, person.locale, person.timeZone));
  for (const item of notice.items ?? [])
    body.push({ card: { title: coachingTime(item.scheduledAt, person.locale, person.timeZone), url: absolute(`/espace-coach/seances/${item.sessionId}`) } });
  body.push({
    action: { label: t(notice.kind === "hour_before" || notice.kind === "day_before" ? "coachingNotices.join" : "coachingNotices.open"), url: absolute(path) },
  });
  return renderEmail({
    language: person.locale,
    subject: t(`coachingNotices.email.${notice.kind}.title`),
    title: t(`coachingNotices.email.${notice.kind}.title`),
    body,
    footer: {
      reason: t("coachingNotices.email.reason"),
      link: { label: t("coachingNotices.settings.title"), url: absolute(person.audience === "coach" ? "/espace-coach/rappels" : "/compte/rappels") },
    },
  });
}
export function coachingNoticePush(person: NoticeRecipient, notice: CoachingNotice): PushNotification {
  if (notice.kind === "daily") return { event: "coaching_day", noticeKey: notice.key };
  if (notice.kind === "paid") return { event: "coaching_session_paid" };
  if (notice.kind === "hour_before")
    return {
      event: person.audience === "candidate" ? "coaching_session_hour" : "coaching_session_hour_for_coach",
      sessionId: notice.sessionId!,
      noticeKey: notice.key,
    };
  if (notice.kind === "day_before") return { event: "coaching_session_eve", sessionId: notice.sessionId!, noticeKey: notice.key };
  return { event: "coaching_session_updated" };
}
