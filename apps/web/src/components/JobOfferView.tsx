import type { JobOffer } from "@jobhub/shared";
import { SkillTags } from "@/components/SkillTags";
import type { getServerT } from "@/i18n/server";
import { jobOfferSalary } from "@/job-offers/at-a-glance";
import { contentBlocks } from "@/job-offers/content-blocks";

type T = Awaited<ReturnType<typeof getServerT>>;

export { jobOfferSalary };

/** The site the Job Offer was captured from: its name, else its host. */
export function jobOfferSite({ source }: Pick<JobOffer, "source">): string | null {
  return source.name ?? (source.url ? new URL(source.url).hostname : null);
}

/**
 * What a Job Offer says at a glance, one framed tile per fact (salary first when it
 * states one), every tile the same width and height, then the skills as tags on a
 * tile of their own across the row: the Application page's header shows them
 * (ADR-0024). Nothing when the offer says none of it.
 */
export function JobOfferTiles({ jobOffer, t, locale }: { jobOffer: JobOffer; t: T; locale: string }) {
  const salaryText = jobOfferSalary(jobOffer, t, locale);
  const tiles: [string, string][] = [];
  if (salaryText) tiles.push([t("jobOffer.salary"), salaryText]);
  if (jobOffer.employer) tiles.push([t("jobOffer.employer"), jobOffer.employer]);
  if (jobOffer.sector) tiles.push([t("jobOffer.sector"), [jobOffer.sector, jobOffer.subsector].filter(Boolean).join(" · ")]);
  if (jobOffer.location) tiles.push([t("jobOffer.location"), jobOffer.location]);
  if (jobOffer.contractType) tiles.push([t("jobOffer.contractType"), t(`cvReview.contractTypes.${jobOffer.contractType}`)]);
  if (jobOffer.remoteWork) tiles.push([t("jobOffer.remoteWork"), t(`cvReview.remoteWorkOptions.${jobOffer.remoteWork}`)]);
  if (jobOffer.requiredExperienceYears !== undefined) tiles.push([t("jobOffer.experience"), t("jobOffer.experienceYears", { years: jobOffer.requiredExperienceYears })]);
  const skills = jobOffer.skills?.length ? jobOffer.skills : null;
  if (tiles.length === 0 && !skills) return null;
  return (
    <>
      {tiles.length > 0 ? (
        <dl className="tiles tiles-even job-offer-tiles" aria-label={t("jobOffer.details")}>
          {tiles.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {skills ? (
        <dl className="tiles job-offer-tiles" aria-label={t("jobOffer.skills")}>
          <div className="tile-wide">
            <dt>{t("jobOffer.skills")}</dt>
            <dd>
              <SkillTags skills={skills} />
            </dd>
          </div>
        </dl>
      ) : null}
    </>
  );
}

/**
 * A Job Offer, read-only: what it says at a glance, then its full text laid out for reading.
 * `details={false}`: the full text only, where the page shows the facts elsewhere (JobOfferTiles).
 */
export function JobOfferView({ jobOffer, t, locale, details = true }: { jobOffer: JobOffer; t: T; locale: string; details?: boolean }) {
  const salaryText = jobOfferSalary(jobOffer, t, locale);
  const site = jobOfferSite(jobOffer);
  return (
    <>
      {details ? (
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
            {jobOffer.skills?.length ? (
              <Detail term={t("jobOffer.skills")}>
                <SkillTags skills={jobOffer.skills} />
              </Detail>
            ) : null}
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
      ) : null}

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
