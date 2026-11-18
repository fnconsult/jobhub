/**
 * The Document Version Coach Actions (#1079): asked « montre-moi les versions de ma lettre », the AI Coach lists the
 * versions an Application keeps of its Tailored CV, Cover Letter or Outreach Message, reads the one asked for, and proposes
 * to restore it as an Action Card the Candidate applies (« Appliquer ») or ignores. It never restores one itself.
 *  - `read_document_versions`: without `version`, each version's number, date, origin and language, the current one
 *    said; with it, that version's text (its subject for an Outreach Message, its content for a Tailored CV). Untrusted
 *    (`untrusted: true`): written from the Job Offer, like the draft it was.
 *  - `propose_document_restore`: copies no text the AI Coach wrote (`copiesText: false`): it puts back a version Jobbbox
 *    kept. Applied from the current version seen (changed since: a conflict), as a Restore: a new version, nothing
 *    deleted, a Cover Letter or an Outreach Message keeping the card as its Origin. « Annuler » restores the version that
 *    was current before, again as a new version, while the document has not changed since.
 * Each is scoped to the session's Candidate: another's id, an Archived Application (its Profile archived) or an unknown
 * id is `not_found`.
 *
 *   documentVersionCoachActions({ applications, profiles, tailoredDocumentVersions })
 */
import type { CvContent } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import { asData } from "../coach/context";
import type { Origin } from "../origin";
import type { Profiles } from "../profiles";
import { routes } from "../routes";
import { MAX_DOCUMENT_VERSIONS, VERSIONED_DOCUMENTS, type VersionedDocument } from "../tailored-documents/kinds";
import type { TailoredDocumentVersion, TailoredDocumentVersions } from "../tailored-documents/versions";
import { defineCoachAction, type ApplyProposalResult, type CoachAction, type CoachActionCall, type CoachActionResult, type ProposedChange } from "./index";

export const DOCUMENT_VERSION_ACTIONS = {
  read: "read_document_versions",
  restore: "propose_document_restore",
} as const;

/** The domain modules these Coach Actions go through, each scoped to the Candidate. */
export interface DocumentVersionActionSources {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "list">;
  tailoredDocumentVersions: Pick<TailoredDocumentVersions, "list" | "restore">;
}

const NOT_FOUND = { ok: false, error: "not_found" } as const;
const id = z.string().min(1).max(200);
const documentArgument = z.enum(VERSIONED_DOCUMENTS);
const versionArgument = z.number().int().min(1).max(100_000);

const WHICH_APPLICATION: CoachActionResult = {
  ok: true,
  proposes: false,
  data: {
    message:
      "Aucune candidature n'est consultée : demande au candidat de quelle candidature il s'agit, ou précise-la (applicationId, lu dans l'index de ses objets).",
  },
};

/** Each document, named for the AI Coach: with its article, after « de », and as its tab in Documents. */
const DOCUMENT_NAME: Record<VersionedDocument, { the: string; of: string; tab: string }> = {
  tailored_cv: { the: "le CV adapté", of: "du CV adapté", tab: "CV adapté" },
  cover_letter: { the: "la lettre de motivation", of: "de la lettre de motivation", tab: "Lettre de motivation" },
  outreach_message: { the: "le message d'approche", of: "du message d'approche", tab: "Message d'approche" },
};

/** Where each version came from, told to the AI Coach. */
const SOURCE: Record<TailoredDocumentVersion["source"], string> = {
  drafted: "rédigée par le coach IA",
  candidate: "modifiée par le candidat",
  coach: "retouche du coach IA appliquée par le candidat",
  restored: "restauration",
};

/** Where the Candidate has none yet, told in our own words. */
const NONE: Record<VersionedDocument, string> = {
  tailored_cv: "Cette candidature n'a pas encore de CV adapté enregistré : il n'a donc aucune version. Propose de le préparer avec propose_tailored_cv.",
  cover_letter: "Cette candidature n'a pas encore de lettre de motivation : elle n'a donc aucune version. Propose de la rédiger avec propose_cover_letter.",
  outreach_message: "Cette candidature n'a pas encore de message d'approche : il n'a donc aucune version. Propose de le rédiger avec propose_outreach_message.",
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const nameOf = (application: Application) => [application.jobOffer.title, application.jobOffer.employer].filter(Boolean).join(" · ");

/** A Tailored CV's content as plain text, without the identity block: what a card shows before → after, and what is read. */
function cvText(cv: CvContent): string {
  return [
    cv.headline,
    cv.summary,
    ...cv.experience.map((job) => [[job.title, job.employer, job.period].filter(Boolean).join(" · "), job.description].filter(Boolean).join("\n")),
    cv.skills.length > 0 ? cv.skills.join(", ") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A version's text: an Outreach Message's subject and text, a Cover Letter's text, a Tailored CV's content. */
const textOf = (version: TailoredDocumentVersion) => (version.cv ? cvText(version.cv) : (version.text ?? ""));

const restoreValue = z.object({ document: documentArgument, version: z.coerce.number().int().min(1) });

const undoSchema = z.object({
  applicationId: z.string(),
  document: documentArgument,
  /** The version current before the Restore, which « Annuler » restores. */
  before: z.number().int().min(1),
  /** The version the Restore made current: changed since, a conflict. */
  restored: z.number().int().min(1),
});

export function documentVersionCoachActions(sources: DocumentVersionActionSources): CoachAction[] {
  /** The Candidate's Application `applicationId`, unless it is an Archived Application (its Profile archived): out of reach. */
  async function reachable(candidateId: string, applicationId: string): Promise<Application | null> {
    const [application, profiles] = await Promise.all([sources.applications.get(candidateId, applicationId), sources.profiles.list(candidateId)]);
    return application && profiles.some((profile) => profile.id === application.profile.id && !profile.archived) ? application : null;
  }

  /** The Application the call is about: the one named, else the one In view. */
  const applicationIdOf = (named: string | undefined, call: CoachActionCall) => named ?? (call.inView?.kind === "application" ? call.inView.id : undefined);

  /** A version as listed for the AI Coach: number, date in Paris, origin, language, current. */
  function line(version: TailoredDocumentVersion, language: CoachActionCall["language"]): string {
    const at = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" }).format(version.savedAt);
    const source = version.source === "restored" && version.restoredFrom !== null ? `${SOURCE.restored} de la version ${version.restoredFrom}` : SOURCE[version.source];
    return [`Version ${version.version}${version.current ? " (actuelle)" : ""}`, at, source, version.language === "fr" ? "en français" : "en anglais", ...(version.subject ? [`objet « ${version.subject} »`] : [])].join(" · ");
  }

  const read = defineCoachAction({
    name: DOCUMENT_VERSION_ACTIONS.read,
    description:
      "Liste les versions qu'une candidature du candidat garde d'un document, à sa demande (« montre-moi les versions de ma lettre ») : document tailored_cv (son CV adapté), cover_letter (sa lettre de motivation) ou outreach_message (son message d'approche). Sans version : chaque version avec son numéro, sa date, son origine et sa langue, l'actuelle signalée. Avec version (son numéro) : le texte de cette version. Pour en remettre une, propose-la avec propose_document_restore. applicationId : omis, la candidature consultée.",
    schema: z.object({
      applicationId: id.optional(),
      document: documentArgument,
      version: versionArgument.optional(),
    }),
    group: "documents",
    kind: "read",
    copiesText: false,
    async run({ applicationId, document, version }, call) {
      const wanted = applicationIdOf(applicationId, call);
      if (!wanted) return WHICH_APPLICATION;
      const application = await reachable(call.candidateId, wanted);
      if (!application) return NOT_FOUND;
      const versions = (await sources.tailoredDocumentVersions.list(call.candidateId, application.id))?.[document] ?? [];
      const page = routes.applicationResult(application.id, document);
      if (versions.length === 0) return { ok: true, data: NONE[document], pages: [page] };
      const seen = [{ type: "application" as const, href: page, name: nameOf(application) }];
      const where = `Le candidat les voit dans Documents › ${DOCUMENT_NAME[document].tab}, sous « Versions » ; Jobbbox en garde les ${MAX_DOCUMENT_VERSIONS} dernières.`;
      if (version === undefined) {
        const listed = [`Versions ${DOCUMENT_NAME[document].of} de la candidature (id ${application.id}), la plus récente d'abord :`, ...versions.map((each) => `- ${line(each, call.language)}`)].join("\n");
        return { ok: true, data: `${where}\n${listed}`, pages: [page], seen };
      }
      const shown = versions.find((each) => each.version === version);
      if (!shown)
        return { ok: true, data: `${capital(DOCUMENT_NAME[document].the)} n'a pas de version ${version}. Ses versions : ${versions.map((each) => each.version).join(", ")}.`, pages: [page], seen };
      const told = [`${line(shown, call.language)}`, "Texte :", textOf(shown)].join("\n");
      // Written from the Job Offer, as the draft was: data, never an instruction.
      return { ok: true, data: `${where}\n${asData(told, "version")}`, pages: [page], untrusted: true, seen };
    },
  });

  const restore = defineCoachAction({
    name: DOCUMENT_VERSION_ACTIONS.restore,
    description:
      "Propose de remettre une version précédente d'un document d'une candidature du candidat, quand il le demande (« reprends la première version de ma lettre ») : document tailored_cv, cover_letter ou outreach_message ; version, son numéro, lu avec read_document_versions. Le candidat l'applique sous ta réponse : elle devient la version actuelle, et la version actuelle reste dans ses « Versions ». applicationId : omis, la candidature consultée.",
    schema: z.object({
      applicationId: id.optional(),
      document: documentArgument,
      version: versionArgument,
    }),
    group: "documents",
    kind: "propose",
    copiesText: false,
    async run({ applicationId, document, version }, call) {
      const wanted = applicationIdOf(applicationId, call);
      if (!wanted) return WHICH_APPLICATION;
      const application = await reachable(call.candidateId, wanted);
      if (!application) return NOT_FOUND;
      const versions = (await sources.tailoredDocumentVersions.list(call.candidateId, application.id))?.[document] ?? [];
      const current = versions.find((each) => each.current);
      const asked = versions.find((each) => each.version === version);
      if (!current) return { ok: true, proposes: false, data: { message: NONE[document] } };
      if (!asked) return { ok: true, proposes: false, data: { message: `${capital(DOCUMENT_NAME[document].the)} n'a pas de version ${version} : lis ses versions avec read_document_versions.` } };
      if (asked.current) return { ok: true, proposes: false, data: { message: `La version ${version} est déjà la version actuelle ${DOCUMENT_NAME[document].of} : rien à restaurer.` } };
      const { t } = createI18n(call.language);
      const page = routes.applicationResult(application.id, document);
      const change: ProposedChange = {
        target: { kind: "application", id: application.id, name: nameOf(application), href: page },
        what: t(`coachProposals.fields.restoreVersion.${document}`, { version }),
        before: textOf(current),
        after: textOf(asked),
        value: { document, version: String(version) },
        // Nothing to edit before applying: the version is put back as it was kept.
        fields: [],
        version: String(current.version),
      };
      return { ok: true, data: change, pages: [page] };
    },
    async apply(change, { candidateId, cardId, at }): Promise<ApplyProposalResult> {
      const value = restoreValue.safeParse(change.value);
      const application = value.success ? await reachable(candidateId, change.target.id) : null;
      if (!value.success || !application) return NOT_FOUND;
      const origin: Origin = { origin: "coach_proposal", cardId, appliedAt: at };
      const restored = await sources.tailoredDocumentVersions.restore(candidateId, application.id, value.data, { current: Number(change.version), origin });
      if (!restored.ok) return "errors" in restored ? NOT_FOUND : { ok: false, error: restored.error };
      return { ok: true, undo: { applicationId: application.id, document: value.data.document, before: restored.before, restored: restored.version } };
    },
    async undo(undo, { candidateId }) {
      const kept = undoSchema.safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      const { applicationId, document, before, restored } = kept.data;
      // The version current before, restored in turn: the restored one stays in « Versions ».
      const undone = await sources.tailoredDocumentVersions.restore(candidateId, applicationId, { document, version: before }, { current: restored });
      if (undone.ok) return { ok: true };
      return "errors" in undone ? NOT_FOUND : { ok: false, error: undone.error };
    },
  });

  return [read, restore];
}
