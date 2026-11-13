import { meetingTool, meetingWindow, type Meeting } from "@jobhub/shared/coaching-meeting";
import { coachingTime } from "@jobhub/shared/coaching-time";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

/** The same joining rules as the web, refreshed while this screen stays open. */
export function SessionJoin({
  meeting,
  scheduledAt,
  durationMinutes,
  timeZone,
}: {
  meeting: Meeting | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  timeZone?: string;
}) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  if (!meeting || !scheduledAt) return null;
  const at = new Date(scheduledAt);
  const state = meetingWindow({ scheduledAt: at, durationMinutes }, new Date(now));
  if (state === "ended") return null;
  if (state === "waiting")
    return <AppText tone="secondary">{t("coachMeeting.available", { date: coachingTime(new Date(+at - 600_000), i18n.language, timeZone) })}</AppText>;
  if (meeting.kind === "phone")
    return <AppText>{t(meeting.direction === "coach_calls" ? "coachMeeting.coachCalls" : "coachMeeting.call", { phone: meeting.target })}</AppText>;
  return <Control label={t(`coachMeeting.join.${meetingTool(meeting.target)}`)} onPress={() => void Linking.openURL(meeting.target).catch(() => {})} />;
}
