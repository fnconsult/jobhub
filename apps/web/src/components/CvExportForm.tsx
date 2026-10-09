import type { getServerT } from "@/i18n/server";
import { DocumentExportForm } from "./DocumentExportForm";

/**
 * Downloads a Profile's current Master CV: the Candidate picks a CV Template,
 * then a file format.
 */
export function CvExportForm({ profileId, t }: { profileId: string; t: Awaited<ReturnType<typeof getServerT>> }) {
  const headingId = `cv-export-${profileId}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t("cvExport.title")}</h2>
      <p>{t("cvExport.intro")}</p>
      <DocumentExportForm action={`/api/profiles/${profileId}/master-cv/export`} idPrefix={headingId} t={t} />
    </section>
  );
}
