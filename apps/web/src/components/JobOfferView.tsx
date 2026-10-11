import type { JobOffer } from "@jobhub/shared";
import type { getServerT } from "@/i18n/server";
import { contentBlocks } from "@/job-offers/content-blocks";

type T = Awaited<ReturnType<typeof getServerT>>;

/** The Job Offer's salary range in words ("De 90 000 à 110 000 € brut par an"), or null when it gives none. */
export function jobOfferSalary({ salary }: Pick<JobOffer, "salary">, t: T, locale: string): string | null {
  const amount = (value: number) => new Intl.NumberFormat(locale).format(value);
  if (salary?.min !== undefined && salary.max !== undefined) return t("jobOffer.salaryRange", { min: amount(salary.min), max: amount(salary.max) });
  if (salary?.min !== undefined) return t("jobOffer.salaryFrom", { amount: amount(salary.min) });
  if (salary?.max !== undefined) return t("jobOffer.salaryUpTo", { amount: amount(salary.max) });
  return null;
}

/** The site the Job Offer was captured from: its name, else its host. */
export function jobOfferSite({ source }: Pick<JobOffer, "source">): string | null {
  return source.name ?? (source.url ? new URL(source.url).hostname : null);
}

/** A Job Offer, read-only: what it says at a glance, then its full text laid out for reading. */
export function JobOfferView({ jobOffer, t, locale }: { jobOffer: JobOffer; t: T; locale: string }) {
  const salaryText = jobOfferSalary(jobOffer, t, locale);
  const site = jobOfferSite(jobOffer);
  return (
    <>
      <section aria-labelledby="job-offer-details">
        <h2 id="job-offer-details">{t("jobOffer.details")}</h2>
        <dl className="job-offer-details">
          {jobOffer.employer ? <Detail term={t("jobOffer.employer")}>{jobOffer.employer}</Detail> : null}
          {jobOffer.location ? <Detail term={t("jobOffer.location")}>{jobOffer.location}</Detail> : null}
          {jobOffer.contractType ? <Detail term={t("jobOffer.contractType")}>{t(`cvReview.contractTypes.${jobOffer.contractType}`)}</Detail> : null}
          {jobOffer.remoteWork ? <Detail term={t("jobOffer.remoteWork")}>{t(`cvReview.remoteWorkOptions.${jobOffer.remoteWork}`)}</Detail> : null}
          {salaryText ? <Detail term={t("jobOffer.salary")}>{salaryText}</Detail> : null}
          {jobOffer.requiredExperienceYears !== undefined ? (
            <Detail term={t("jobOffer.experience")}>{t("jobOffer.experienceYears", { years: jobOffer.requiredExperienceYears })}</Detail>
          ) : null}
          {jobOffer.skills?.length ? <Detail term={t("jobOffer.skills")}>{jobOffer.skills.join(", ")}</Detail> : null}
          {site ? (
            <Detail term={t("jobOffer.source")}>
              {jobOffer.source.url ? (
                <a href={jobOffer.source.url} rel="noopener noreferrer nofollow" target="_blank">
                  {t("jobOffer.sourceLink", { site })}
                </a>
              ) : (
                site
              )}
            </Detail>
          ) : null}
        </dl>
      </section>

      <section className="job-offer-content" aria-labelledby="job-offer-content">
        <h2 id="job-offer-content">{t("jobOffer.contentTitle")}</h2>
        {contentBlocks(jobOffer.content).map((block, index) =>
          block.kind === "heading" ? (
            <h3 key={index}>{block.text}</h3>
          ) : block.kind === "list" ? (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          ) : (
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                <span key={lineIndex}>
                  {lineIndex > 0 ? <br /> : null}
                  {line}
                </span>
              ))}
            </p>
          ),
        )}
      </section>
    </>
  );
}

/**
 * Says the Job Offer is an Expired Job Offer, and since when; nothing when it is
 * still published. `children` adds what it means for the page it is on.
 */
export function ExpiredJobOfferNotice({ jobOffer, t, locale, children }: { jobOffer: JobOffer; t: T; locale: string; children?: React.ReactNode }) {
  if (!jobOffer.expiredAt) return null;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(jobOffer.expiredAt);
  return (
    <div className="notice notice-expired" role="status">
      <p>{t("jobOffer.expired", { date })}</p>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}
