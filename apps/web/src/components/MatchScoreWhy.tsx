import type { CriterionStatus } from "@jobhub/shared";
import type { TFunction } from "i18next";
import type { MatchScoreReason } from "@/components/job-search-words";

/** A verdict is said in words; the colour only reinforces a clear match or mismatch. */
const VERDICT_TONE: Partial<Record<CriterionStatus, string>> = { match: "success", mismatch: "danger" };

/**
 * "Pourquoi 86 ?" (`summary`), opening the reasons of a Match Score: one line
 * per criterion with its verdict (see `matchScoreReasons`). Holds no state, so
 * server and client pages alike can show it.
 */
export function MatchScoreWhy({ summary, reasons }: { summary: string; reasons: readonly MatchScoreReason[] }) {
  return (
    <details className="why">
      <summary>{summary}</summary>
      <ul className="breakdown">
        {reasons.map((reason) => (
          <li key={reason.text}>
            <span className="verdict" data-tone={VERDICT_TONE[reason.status]}>
              {reason.verdict}
            </span>
            <span>{reason.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The Match Score of a Job Offer against one Profile, as the Job Offer page
 * shows it: the score out of 100, naming the Profile, then "Pourquoi 86 ?".
 * `live` announces a new score, when the Candidate picks another Profile.
 */
export function ProfileMatchScore({
  profileName,
  score,
  reasons,
  live,
  t,
}: {
  profileName: string;
  score: number;
  reasons: readonly MatchScoreReason[];
  live?: boolean;
  t: TFunction;
}) {
  return (
    <div className="profile-match">
      <p aria-live={live ? "polite" : undefined}>
        {t("jobOffer.matchScore", { profile: profileName })} <strong className="score">{t("matchScore.score", { score })}</strong>
      </p>
      <MatchScoreWhy summary={t("jobSearch.why", { score })} reasons={reasons} />
    </div>
  );
}
