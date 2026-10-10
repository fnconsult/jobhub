"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationExportKind } from "@/application-exports/kinds";
import { DocumentExportForm } from "./DocumentExportForm";

const PATHS = { tailored_cv: "tailored-cv", cover_letter: "cover-letter" } as const satisfies Record<ApplicationExportKind, string>;
const KEYS = { tailored_cv: "applicationExport.tailoredCv", cover_letter: "applicationExport.coverLetter" } as const satisfies Record<ApplicationExportKind, string>;

/** Downloads an Application's saved Tailored CV or Cover Letter as a PDF or Word file. Shown only once the document is saved. */
export function ApplicationExportForm({ applicationId, document }: { applicationId: string; document: ApplicationExportKind }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="stack" role="group" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>{t(`${KEYS[document]}.title`)}</h4>
      <p className="hint">{t(`${KEYS[document]}.intro`)}</p>
      <DocumentExportForm action={`/api/applications/${applicationId}/${PATHS[document]}/export`} idPrefix={id} t={t} />
    </div>
  );
}
