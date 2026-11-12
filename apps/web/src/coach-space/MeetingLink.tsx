"use client";
import { coachingTime } from "@jobhub/shared/coaching-time";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "@/components/ExternalLink";
import { buttonClass } from "@/design/button-class";
import { meetingTool, meetingWindow, type Meeting } from "./meeting";

/** The button updates while the page is open, including when it first becomes available. */
export function MeetingLink({
  meeting,
  scheduledAt,
  durationMinutes,
  timeZone,
  coach = false,
}: {
  meeting: Meeting | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  timeZone?: string;
  coach?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  if (!meeting) return null;
  const at = scheduledAt ? new Date(scheduledAt) : null;
  const window = meetingWindow({ scheduledAt: at, durationMinutes }, new Date(now));
  if (window === "ended" || !at) return null;
  if (window === "waiting") return <p>{t("coachMeeting.available", { date: coachingTime(new Date(+at - 600_000), i18n.language, timeZone) })}</p>;
  if (meeting.kind === "phone")
    return (
      <p>
        {t(
          coach
            ? meeting.direction === "coach_calls"
              ? "coachMeeting.call"
              : "coachMeeting.candidateCalls"
            : meeting.direction === "coach_calls"
              ? "coachMeeting.coachCalls"
              : "coachMeeting.call",
          { phone: meeting.target },
        )}
      </p>
    );
  return (
    <ExternalLink className={buttonClass({ variant: "primary" })} href={meeting.target}>
      {t(`coachMeeting.join.${meetingTool(meeting.target)}`)}
    </ExternalLink>
  );
}
