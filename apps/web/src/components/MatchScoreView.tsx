import type { CriterionStatus, MatchScore, SalaryRange } from "@jobhub/shared";
import type { getServerT } from "@/i18n/server";

type T = Awaited<ReturnType<typeof getServerT>>;

/** A Match Score and its breakdown, criterion by criterion, in plain words. */
export function MatchScoreView({ matchScore, profileName, t, locale }: { matchScore: MatchScore; profileName: string; t: T; locale: string }) {
  const { skills, seniority, location, salary, contractType } = matchScore.breakdown;
  const amount = (value: number) => new Intl.NumberFormat(locale).format(value);
  const range = (offer: SalaryRange) => [offer.min, offer.max].filter((value) => value !== undefined).map(amount).join(" – ");
  const contract = (value: string | undefined) => (value ? t(`cvReview.contractTypes.${value as "cdi"}`) : t("profile.notSpecified"));
  const orNotSpecified = (value: string | undefined) => value ?? t("profile.notSpecified");
  return (
    <section className="match-score" aria-labelledby="match-score-title">
      <h2 id="match-score-title">{t("matchScore.title")}</h2>
      <p className="match-score-value">{t("matchScore.score", { score: matchScore.score })}</p>
      <p>{t("matchScore.intro", { profile: profileName })}</p>
      <dl className="match-score-breakdown">
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
            <p>{t("matchScore.offerAndWanted", { offer: orNotSpecified(location.offer), wanted: orNotSpecified(location.wanted) })}</p>
          ) : null}
        </Criterion>
        <Criterion name={t("matchScore.criteria.salary")} status={salary.status} t={t}>
          {salary.offer ? <p>{t("matchScore.salaryOffer", { offer: range(salary.offer) })}</p> : null}
          {salary.wanted !== undefined ? <p>{t("matchScore.salaryWanted", { amount: amount(salary.wanted) })}</p> : null}
        </Criterion>
        <Criterion name={t("matchScore.criteria.contractType")} status={contractType.status} t={t}>
          {contractType.status !== "unknown" ? (
            <p>{t("matchScore.offerAndWanted", { offer: contract(contractType.offer), wanted: contract(contractType.wanted) })}</p>
          ) : null}
        </Criterion>
      </dl>
      <p className="hint">{t("matchScore.unknownHint")}</p>
    </section>
  );
}

function Criterion({ name, status, t, children }: { name: string; status: CriterionStatus; t: T; children?: React.ReactNode }) {
  return (
    <div className="match-score-criterion">
      <dt>{name}</dt>
      <dd>
        <p className={`match-status match-status-${status}`}>{t(`matchScore.statuses.${status}`)}</p>
        {children}
      </dd>
    </div>
  );
}

function SkillList({ title, skills }: { title: string; skills: string[] }) {
  return (
    <>
      <p>{title}</p>
      <ul className="skill-list">
        {skills.map((skill) => (
          <li key={skill}>{skill}</li>
        ))}
      </ul>
    </>
  );
}
