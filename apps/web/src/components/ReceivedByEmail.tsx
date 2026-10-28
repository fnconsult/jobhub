import type { TFunction } from "i18next";
import Link from "next/link";
import type { ReceivedOffer, ReceivedOffersOverview } from "@/email-intake/received-offers";
import { JobOfferResults } from "@/components/JobOfferResults";
import { routes } from "@/routes";

/** The ids of a « Reçues par email » list's titles: apart from the Job Search results of the same Profile. */
const ID_SCOPE = "received-by-email";

const dayFormat = (locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" });

/**
 * One Profile's « Reçues par email » (#447): the Job Offers Email intake gave it, newest first, with how many arrived
 * this week (« nouvelles »), each row as a Job Search result (Match Score, save, « Pourquoi N ? »).
 */
export function ReceivedByEmail({
  profile,
  group,
  t,
  locale,
  headingLevel,
}: {
  profile: { id: string; name: string };
  group: { offers: ReceivedOffer[]; fresh: number } | undefined;
  t: TFunction;
  locale: string;
  headingLevel: 2 | 4;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h4";
  const titleId = `received-by-email-${headingLevel}-${profile.id}`;
  const offers = group?.offers ?? [];
  return (
    <section className="section received-by-email" aria-labelledby={titleId}>
      <div className="section-head">
        <Heading id={titleId}>{t("receivedByEmail.title")}</Heading>
        <span className="pill" data-tone={group?.fresh ? "accent" : undefined}>
          {t("receivedByEmail.fresh", { count: group?.fresh ?? 0 })}
        </span>
      </div>
      {offers.length > 0 ? (
        <>
          <p>{t("receivedByEmail.intro", { count: offers.length })}</p>
          <JobOfferResults
            results={offers}
            profileId={profile.id}
            t={t}
            locale={locale}
            headingLevel={headingLevel === 2 ? 3 : 5}
            label={t("receivedByEmail.listLabel", { profile: profile.name })}
            idScope={ID_SCOPE}
          />
        </>
      ) : (
        <p className="notice">{t("receivedByEmail.none")}</p>
      )}
    </section>
  );
}

/**
 * What Email intake did for the Candidate as a whole (#447): « Filtre trop large » past the daily threshold (leading
 * to the forwarding setup wizard), the « Non classées » Job Offers, and the emails ignored this week with their reason,
 * sender's domain and date, never their content. With Email intake off and nothing received: an invitation to set it up.
 */
export function EmailIntakeStanding({
  overview,
  switchedOn,
  t,
  locale,
  headingLevel,
}: {
  overview: ReceivedOffersOverview;
  switchedOn: boolean;
  t: TFunction;
  locale: string;
  headingLevel: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const RowHeading = headingLevel === 2 ? "h3" : "h4";
  const day = dayFormat(locale);
  const { unclassified, ignored, tooBroad } = overview;
  const anything = unclassified.offers.length > 0 || ignored.length > 0 || tooBroad !== null || Object.keys(overview.byProfile).length > 0;
  if (!switchedOn && !anything) {
    return (
      <p className="hint">
        {t("receivedByEmail.off")} <Link className="props-action" href={routes.accountEmailIntakeWizard}>
          {t("receivedByEmail.setUp")}
        </Link>
      </p>
    );
  }
  return (
    <>
      {tooBroad ? (
        <div className="notice notice-failed" role="note" aria-labelledby="email-intake-too-broad">
          <p>
            <strong id="email-intake-too-broad">{t("receivedByEmail.tooBroad.title")}</strong>{" "}
            {t("receivedByEmail.tooBroad.text", { count: tooBroad.count, date: day.format(new Date(`${tooBroad.day}T12:00:00Z`)) })}
          </p>
          <p>
            <Link className="props-action" href={routes.accountEmailIntakeWizard}>
              {t("receivedByEmail.tooBroad.link")}
            </Link>
          </p>
        </div>
      ) : null}
      <section className="section received-by-email" aria-labelledby="received-by-email-unclassified">
        <div className="section-head">
          <Heading id="received-by-email-unclassified">{t("receivedByEmail.unclassified.title")}</Heading>
          <span className="pill" data-tone={unclassified.fresh ? "accent" : undefined}>
            {t("receivedByEmail.fresh", { count: unclassified.fresh })}
          </span>
        </div>
        {unclassified.offers.length > 0 ? (
          <>
            <p className="hint">{t("receivedByEmail.unclassified.intro")}</p>
            <ol className="rows" aria-label={t("receivedByEmail.unclassified.listLabel")}>
              {unclassified.offers.map(({ jobOffer, matchScore, applicationId, receivedAt, senderDomain }) => {
                const titleId = `${ID_SCOPE}-unclassified-${jobOffer.id}`;
                return (
                  <li className="row" key={jobOffer.id}>
                    <div className="row-main">
                      <RowHeading className="row-title" id={titleId}>
                        <Link href={applicationId ? routes.application(applicationId) : routes.jobOffer(jobOffer.id)}>{jobOffer.title}</Link>
                      </RowHeading>
                      <p className="row-meta">
                        {jobOffer.employer ? <span>{jobOffer.employer}</span> : null}
                        {jobOffer.location ? <span>{jobOffer.location}</span> : null}
                        <span>{t("receivedByEmail.receivedFrom", { date: day.format(receivedAt), domain: senderDomain })}</span>
                        <span>{t("receivedByEmail.unclassified.bestScore", { score: matchScore })}</span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className="notice">{t("receivedByEmail.unclassified.none")}</p>
        )}
      </section>
      <section className="section received-by-email" aria-labelledby="received-by-email-ignored">
        <div className="section-head">
          <Heading id="received-by-email-ignored">{t("receivedByEmail.ignored.title", { count: ignored.length })}</Heading>
        </div>
        {ignored.length > 0 ? (
          <>
            <p className="hint">{t("receivedByEmail.ignored.intro")}</p>
            <ul className="received-by-email-ignored" aria-label={t("receivedByEmail.ignored.listLabel")}>
              {ignored.map((email, index) => (
                <li key={`${email.receivedAt.toISOString()}-${index}`}>
                  {t("receivedByEmail.ignored.item", {
                    reason: t(`receivedByEmail.ignored.reasons.${email.reason}`),
                    domain: email.senderDomain,
                    date: day.format(email.receivedAt),
                  })}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </>
  );
}
