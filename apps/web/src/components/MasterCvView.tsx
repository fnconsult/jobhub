import type { MasterCvContent } from "@jobhub/shared";
import type { getServerT } from "@/i18n/server";

/** One version of a Master CV, read-only, section by section. */
export function MasterCvView({ cv, t }: { cv: MasterCvContent; t: Awaited<ReturnType<typeof getServerT>> }) {
  return (
    <section className="cv">
      {cv.fullName ? <p className="cv-name">{cv.fullName}</p> : null}
      {cv.headline ? <p>{cv.headline}</p> : null}
      {[cv.email, cv.phone, cv.location].some(Boolean) ? <p>{[cv.email, cv.phone, cv.location].filter(Boolean).join(" · ")}</p> : null}
      {cv.summary ? <p className="cv-text">{cv.summary}</p> : null}

      {cv.experience.length > 0 ? (
        <>
          <h3>{t("cvReview.experience")}</h3>
          <ul className="cv-list">
            {cv.experience.map((job, index) => (
              <li key={index}>
                <p className="cv-entry">{[job.title, job.employer, job.location, job.period].filter(Boolean).join(" · ")}</p>
                {job.description ? <p className="cv-text">{job.description}</p> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {cv.education.length > 0 ? (
        <>
          <h3>{t("cvReview.education")}</h3>
          <ul className="cv-list">
            {cv.education.map((item, index) => (
              <li key={index}>{[item.degree, item.institution, item.year].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </>
      ) : null}

      {cv.skills.length > 0 ? (
        <>
          <h3>{t("cvReview.skills")}</h3>
          <ul className="cv-list">
            {cv.skills.map((skill, index) => (
              <li key={index}>{skill}</li>
            ))}
          </ul>
        </>
      ) : null}

      {cv.languages.length > 0 ? (
        <>
          <h3>{t("cvReview.languages")}</h3>
          <ul className="cv-list">
            {cv.languages.map((language, index) => (
              <li key={index}>{[language.name, language.level].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
