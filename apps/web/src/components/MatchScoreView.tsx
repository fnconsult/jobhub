import { wantedValues, type CriterionStatus, type MatchScore, type SalaryRange } from "@jobhub/shared";
import { anyOfInWords, matchScoreFigure, matchScoreInWords, matchScoreReliabilityHint } from "@/components/job-search-words";
import type { getServerT } from "@/i18n/server";
import { HelpText } from "@/components/HelpTerm";
import { SkillTags } from "@/components/SkillTags";

type T = Awaited<ReturnType<typeof getServerT>>;

/**
 * A Match Score and its breakdown, criterion by criterion, in plain words: each
 * one's verdict first (match, partial, mismatch, unknown), then what was compared.
 * Its heading is `#match-score-title`, which a page can link to.
 */
export function MatchScoreView({ matchScore, profileName, t, locale }: { matchScore: MatchScore; profileName: string; t: T; locale: string }) {
  const { skills, seniority, location, salary, contractType } = matchScore.breakdown;
  const amount = (value: number) => new Intl.NumberFormat(locale).format(value);
  const range = (offer: SalaryRange) => [offer.min, offer.max].filter((value) => value !== undefined).map(amount).join(" – ");
  const contract = (value: string | undefined) => (value ? t(`cvReview.contractTypes.${value as "cdi"}`) : t("profile.notSpecified"));
  const orNotSpecified = (value: string | undefined) => value || t("profile.notSpecified");
  // Any one of the values wanted is enough (ADR-0025): "Lyon ou Bordeaux".
  const anyOf = (values: string[]) => orNotSpecified(anyOfInWords(values, locale));
  const figure = matchScoreFigure(matchScore);
  const reliabilityHint = matchScoreReliabilityHint(figure, t);
  return (
    <section className="section match-score" aria-labelledby="match-score-title">
      <div className="section-head">
        <h2 id="match-score-title" tabIndex={-1}>
          {t("matchScore.title")}
        </h2>
        <p className="score">{matchScoreInWords(figure, t)}</p>
      </div>
      <p>
        <HelpText terms={{ matchScore: t("matchScore.title"), masterCv: t("helpTerms.words.masterCv") }}>{t("matchScore.intro", { profile: profileName })}</HelpText>
      </p>
      {reliabilityHint ? <p className="notice">{reliabilityHint}</p> : null}
      <ul className="breakdown">
        <Criterion name={t("matchScore.criteria.skills")} status={skills.status} t={t}>
          {skills.covered.length > 0 ? <SkillList title={t("matchScore.covered")} skills={skills.covered} /> : null}
          {skills.missing.length > 0 ? <SkillList title={t("matchScore.missing")} skills={skills.missing} /> : null}
        </Criterion>
        <Criterion name={t("matchScore.criteria.seniority")} status={seniority.status} t={t}>
          {seniority.cvYears !== undefined && seniority.requiredYears !== undefined ? (
            <p>{t("matchScore.seniorityDetail", { cvYears: seniority.cvYears, requiredYears: seniority.requiredYears })}</p>
          ) : null}
        </Criterion>
        <Criterion name={t("matchScore.criteria.location")} status={location.status} t={t}>
          {location.status !== "unknown" ? (
            <p>{t("matchScore.offerAndWanted", { offer: orNotSpecified(location.offer), wanted: anyOf(wantedValues(location)) })}</p>
          ) : null}
        </Criterion>
        <Criterion name={t("matchScore.criteria.salary")} status={salary.status} t={t}>
          {salary.offer ? <p>{t("matchScore.salaryOffer", { offer: range(salary.offer) })}</p> : null}
          {salary.wanted !== undefined ? <p>{t("matchScore.salaryWanted", { amount: amount(salary.wanted) })}</p> : null}
        </Criterion>
        <Criterion name={t("matchScore.criteria.contractType")} status={contractType.status} t={t}>
          {contractType.status !== "unknown" ? (
            <p>{t("matchScore.offerAndWanted", { offer: contract(contractType.offer), wanted: anyOf(wantedValues(contractType).map((value) => contract(value))) })}</p>
          ) : null}
        </Criterion>
      </ul>
      <p className="hint">{t("matchScore.unknownHint")}</p>
    </section>
  );
}

/** A verdict's colour only reinforces its words (ADR-0009). */
const TONES: Record<CriterionStatus, string | undefined> = { match: "success", partial: undefined, mismatch: "danger", unknown: undefined };

function Criterion({ name, status, t, children }: { name: string; status: CriterionStatus; t: T; children?: React.ReactNode }) {
  return (
    <li>
      <p className="verdict" data-tone={TONES[status]}>
        {t(`matchScore.statuses.${status}`)}
      </p>
      <div>
        <p className="breakdown-criterion">{name}</p>
        {children}
      </div>
    </li>
  );
}

function SkillList({ title, skills }: { title: string; skills: string[] }) {
  return (
    <>
      <p>{title}</p>
      <SkillTags skills={skills} />
    </>
  );
}
