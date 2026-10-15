/**
 * Downloading an Application's saved documents, its Tailored CV and its Cover
 * Letter, as a PDF or Word (.docx) file laid out with a CV Template (#67).
 *
 * One deep module in front of the Tailored CV and Tailored Documents modules
 * and the export engine. Callers get
 * `createApplicationExports({ applications, profiles, tailoredCvs, tailoredDocuments })`
 * and `file(candidateId, applicationId, document, { format, template })`.
 *
 * Rules kept here:
 *  - Only what the Candidate saved is exported: the saved Tailored CV (never a
 *    proposal under review) and the stored Cover Letter.
 *  - Each is written in its own Document Language.
 *  - The Cover Letter is signed with the contact details of the Application's
 *    Profile's Master CV, addressed to the employer and dated the day of the
 *    export. Only its body is taken from the stored text, in plain text: the
 *    sender block and date appear once, the Candidate's name once (#162).
 *  - The file name names the document, the Candidate and the employer.
 * Every read is scoped to the Candidate: someone else's Application exports nothing.
 */
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { Applications } from "../applications";
import { exportDocument, type CvTemplate, type ExportableDocument, type ExportedFile, type ExportFormat } from "../export";
import type { Profiles } from "../profiles";
import type { TailoredCvs } from "../tailored-cv";
import { coverLetterBody, type TailoredDocuments } from "../tailored-documents";
import type { ApplicationExportKind } from "./kinds";

export { APPLICATION_EXPORTS, type ApplicationExportKind } from "./kinds";

export interface ApplicationExports {
  /**
   * The saved document as a file, or null: no such Application for this
   * Candidate, or no saved document of that kind yet.
   */
  file(candidateId: string, applicationId: string, document: ApplicationExportKind, options: { format: ExportFormat; template: CvTemplate }): Promise<ExportedFile | null>;
}

export interface ApplicationExportsDeps {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "get">;
  tailoredCvs: Pick<TailoredCvs, "get">;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
  /** The day a Cover Letter is dated: today by default. */
  now?: () => Date;
}

/** Where and when a Cover Letter is written, in its Document Language: "Lyon, le 7 octobre 2026". The place is the Master CV's location, up to its first comma. */
function letterDate(location: string, day: Date, language: Locale): string {
  const { t } = createI18n(language);
  const date = new Intl.DateTimeFormat(language === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(day);
  const place = (location.split(",")[0] ?? "").trim();
  return place ? t("cvDocument.letterDate", { place, date }) : t("cvDocument.letterDateWithoutPlace", { date });
}

export function createApplicationExports(deps: ApplicationExportsDeps): ApplicationExports {
  /** The document to export, in its Document Language, or null when there is none saved. */
  async function documentOf(candidateId: string, applicationId: string, kind: ApplicationExportKind, profileId: string, employer: string) {
    if (kind === "tailored_cv") {
      const saved = (await deps.tailoredCvs.get(candidateId, applicationId))?.saved;
      return saved ? { document: { kind: "cv", content: saved.content } satisfies ExportableDocument, language: saved.language } : null;
    }
    const [drafts, profile] = await Promise.all([deps.tailoredDocuments.get(candidateId, applicationId), deps.profiles.get(candidateId, profileId)]);
    const letter = drafts?.coverLetter;
    if (!letter) return null;
    const { fullName = "", email = "", phone = "", location = "" } = profile?.masterCv.content ?? {};
    const document: ExportableDocument = {
      kind: "cover_letter",
      content: {
        fullName,
        email,
        phone,
        location,
        recipient: employer,
        date: letterDate(location, (deps.now ?? (() => new Date()))(), letter.language),
        subject: "",
        // Whatever the stored text frames the letter with is left out: the frame above is the only one (#162).
        body: coverLetterBody(letter.text, { fullName }),
      },
    };
    return { document, language: letter.language };
  }

  return {
    async file(candidateId, applicationId, kind, { format, template }) {
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return null;
      const employer = application.jobOffer.employer ?? "";
      const found = await documentOf(candidateId, application.id, kind, application.profile.id, employer);
      if (!found) return null;
      return exportDocument(found.document, { format, template, language: found.language, employer });
    },
  };
}
