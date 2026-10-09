import type { TFunction } from "i18next";
import { CV_TEMPLATES, EXPORT_FORMATS } from "@/export/kinds";

/**
 * Downloads a document from `action`: the Candidate picks a CV Template, then a
 * file format. A plain form, so it works without JavaScript and every download
 * is a regular browser download. No hooks: it renders on the server (the Master
 * CV) and in client components (an Application's documents) alike, with their `t`.
 */
export function DocumentExportForm({ action, idPrefix, t }: { action: string; idPrefix: string; t: TFunction }) {
  return (
    <form method="get" action={action} className="stack">
      <fieldset className="fieldset">
        <legend>{t("cvExport.template")}</legend>
        {CV_TEMPLATES.map((template, index) => (
          <div key={template} className="choice">
            <input
              type="radio"
              id={`${idPrefix}-${template}`}
              name="template"
              value={template}
              defaultChecked={index === 0}
              aria-describedby={`${idPrefix}-${template}-hint`}
            />
            <label htmlFor={`${idPrefix}-${template}`}>{t(`cvExport.templates.${template}.name`)}</label>
            <p id={`${idPrefix}-${template}-hint`} className="hint">
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
  );
}
