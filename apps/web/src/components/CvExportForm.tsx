import { CV_TEMPLATES, EXPORT_FORMATS } from "@/export";
import type { getServerT } from "@/i18n/server";

/**
 * Downloads a Profile's current Master CV: the Candidate picks a CV Template,
 * then a file format. A plain form, so it works without JavaScript and every
 * download is a regular browser download.
 */
export function CvExportForm({ profileId, t }: { profileId: string; t: Awaited<ReturnType<typeof getServerT>> }) {
  const headingId = `cv-export-${profileId}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t("cvExport.title")}</h2>
      <p>{t("cvExport.intro")}</p>
      <form method="get" action={`/api/profiles/${profileId}/master-cv/export`} className="stack">
        <fieldset className="fieldset">
          <legend>{t("cvExport.template")}</legend>
          {CV_TEMPLATES.map((template, index) => (
            <div key={template} className="choice">
              <input
                type="radio"
                id={`${headingId}-${template}`}
                name="template"
                value={template}
                defaultChecked={index === 0}
                aria-describedby={`${headingId}-${template}-hint`}
              />
              <label htmlFor={`${headingId}-${template}`}>{t(`cvExport.templates.${template}.name`)}</label>
              <p id={`${headingId}-${template}-hint`} className="hint">
                {t(`cvExport.templates.${template}.description`)}
              </p>
            </div>
          ))}
        </fieldset>
        <div className="actions">
          {EXPORT_FORMATS.map((format, index) => (
            <button key={format} type="submit" name="format" value={format} className={index === 0 ? "button button-primary" : "button"}>
              {t(`cvExport.${format}`)}
            </button>
          ))}
        </div>
      </form>
    </section>
  );
}
