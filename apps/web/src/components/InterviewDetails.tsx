import { interviewEndsAt, interviewPlaceParts, type Interview } from "@/applications";
import type { getServerT } from "@/i18n/server";

type T = Awaited<ReturnType<typeof getServerT>>;

/**
 * When an Interview starts and ends, "14:30 – 15:30", with `time` (French time): it is
 * shown to last an hour when the Candidate gave no duration.
 */
export function InterviewTimes({ interview, time }: { interview: Pick<Interview, "scheduledAt" | "durationMinutes">; time: Intl.DateTimeFormat }) {
  const endsAt = interviewEndsAt(interview);
  return (
    <>
      <time dateTime={interview.scheduledAt.toISOString()}>{time.format(interview.scheduledAt)}</time>
      {" – "}
      <time dateTime={endsAt.toISOString()}>{time.format(endsAt)}</time>
    </>
  );
}

/**
 * How an Interview takes place and where: its format and its place, any http or https
 * web address in the place a link. Nothing when the Candidate gave neither.
 */
export function InterviewFacts({ interview, t }: { interview: Pick<Interview, "format" | "place">; t: T }) {
  const place = interviewPlaceParts(interview.place);
  if (!interview.format && place.length === 0) return null;
  return (
    <p className="interview-facts">
      {interview.format ? <span className="interview-format">{t(`interviewFormats.${interview.format}`)}</span> : null}
      {place.length > 0 ? (
        <span className="interview-place">
          {place.map((part, index) =>
            part.href ? (
              <a key={index} href={part.href} rel="noopener noreferrer" target="_blank">
                {part.text}
              </a>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </span>
      ) : null}
    </p>
  );
}
