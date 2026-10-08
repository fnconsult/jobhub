import type { KeptAtsScore } from "@/ats-score";
import type { getServerT } from "@/i18n/server";
import { AtsScoreButton } from "./AtsScoreButton";

type T = Awaited<ReturnType<typeof getServerT>>;

/**
 * A Profile's ATS Score: its breakdown into Readability and keywords, the
 * Master CV version it was computed on, and the button to (re)compute it.
 */
export function AtsScoreView({
  profileId,
  targetRole,
  currentVersion,
  atsScore,
  t,
}: {
  profileId: string;
  targetRole: string;
  currentVersion: number;
  atsScore: KeptAtsScore | null;
  t: T;
}) {
  return (
    <section className="ats-score stack" aria-labelledby="ats-score-title">
      <h2 id="ats-score-title">{t("atsScore.title")}</h2>
      <p>{t("atsScore.intro", { role: targetRole })}</p>
      {atsScore ? <Breakdown atsScore={atsScore} currentVersion={currentVersion} t={t} /> : <p>{t("atsScore.notYet")}</p>}
      <AtsScoreButton profileId={profileId} computed={atsScore !== null} />
    </section>
  );
}

function Breakdown({ atsScore, currentVersion, t }: { atsScore: KeptAtsScore; currentVersion: number; t: T }) {
  const { readability, keywords } = atsScore.score.breakdown;
  return (
    <>
      <p className="match-score-value" aria-label={t("atsScore.scoreLabel", { score: atsScore.score.score })}>
        {t("atsScore.score", { score: atsScore.score.score })}
      </p>
      <p className="hint">
        {t("atsScore.computedOn", { version: atsScore.version })}
        {atsScore.version !== currentVersion ? ` ${t("atsScore.outdated")}` : null}
      </p>
      <dl className="match-score-breakdown">
        <div className="match-score-criterion">
          <dt>{t("atsScore.readability")}</dt>
          <dd>
            <p className="match-status">{t("atsScore.score", { score: readability.score })}</p>
            <ul className="ats-checks">
              {readability.checks.map(({ check, passed }) => (
                <li key={check}>
                  {t(`atsScore.checks.${check}`)} — <strong>{t(passed ? "atsScore.passed" : "atsScore.failed")}</strong>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="match-score-criterion">
          <dt>{t("atsScore.keywords")}</dt>
          <dd>
            <p className="match-status">{t("atsScore.score", { score: keywords.score })}</p>
            <Keywords title={t("atsScore.listed")} keywords={keywords.listed} t={t} />
            <Keywords title={t("atsScore.mentioned")} keywords={keywords.mentioned} t={t} />
            <Keywords title={t("atsScore.missing")} keywords={keywords.missing} t={t} />
            {keywords.missing.length > 0 ? <p className="hint">{t("atsScore.missingHint")}</p> : null}
          </dd>
        </div>
      </dl>
    </>
  );
}

function Keywords({ title, keywords, t }: { title: string; keywords: string[]; t: T }) {
  return (
    <>
      <p>{title}</p>
      {keywords.length > 0 ? (
        <ul className="skill-list" aria-label={title}>
          {keywords.map((keyword) => (
            <li key={keyword}>{keyword}</li>
          ))}
        </ul>
      ) : (
        <p>{t("atsScore.none")}</p>
      )}
    </>
  );
}
