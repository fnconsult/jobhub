/**
 * The « Documents » Coach Actions (#721, ADR-0077): what the AI Coach proposes for an Application's Tailored Documents. It
 * never writes one in its reply: each proposal is an Action Card that launches the AI action the documents page runs,
 * through its own route (its Task Playbook, its own Provenance), in the Candidate's request, its steps live on the card
 * beside « Arrêter »; no « Annuler » (`runs`, ./index.ts).
 *  - `propose_tailored_cv`: « Préparer » runs the Tailored CV proposal; its Tailored CV Review then opens in the Work Pane,
 *    reviewed change by change (ADR-0006). The proposal never overwrites the saved Tailored CV: nothing to confirm.
 *  - `propose_cover_letter`, `propose_outreach_message`: « Rédiger » runs the drafting. A draft that exists is replaced,
 *    edits included: the card says so (`replaces`) and the Candidate confirms it first; applied from the draft seen (written
 *    or edited since: a conflict).
 * None copies text (`copiesText: false`): the AI action reads the Job Offer by its own rules, so they stay offered with an
 * Application In view. Each is scoped to the session's Candidate: another's id, an Archived Application (its Profile
 * archived) or an unknown id is `not_found`.
 *
 *   documentCoachActions({ applications, profiles, tailoredCvs, tailoredDocuments })
 */
import { DOCUMENT_LANGUAGES, type DocumentLanguage } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import type { Profiles } from "../profiles";
import { routes, type ApplicationResult } from "../routes";
import type { TailoredCvs } from "../tailored-cv";
import type { ApplicationDrafts, TailoredDocuments } from "../tailored-documents";
import { OUTREACH_CHANNELS, type TailoredDocumentKind } from "../tailored-documents/kinds";
import { defineCoachAction, type CoachAction, type CoachActionCall, type CoachActionResult, type ProposedChange } from "./index";

/** The domain modules these Coach Actions read, each scoped to the Candidate. */
export interface DocumentActionSources {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "list">;
  tailoredCvs: Pick<TailoredCvs, "get">;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
}

export const DOCUMENT_ACTIONS = { tailoredCv: "propose_tailored_cv", coverLetter: "propose_cover_letter", outreachMessage: "propose_outreach_message" } as const;

const id = z.string().min(1).max(200);
const NOT_FOUND = { ok: false, error: "not_found" } as const;
const CONFLICT = { ok: false, error: "conflict" } as const;

/** A Tailored CV proposal replaces only the proposal under review, never the saved Tailored CV: any state will do. */
const ANY = "any";
/** The version of a draft not written yet. */
const NO_DRAFT = "none";

const WHICH_APPLICATION: CoachActionResult = {
  ok: true,
  proposes: false,
  data: { message: "Aucune candidature n'est consultée : demande au candidat de quelle candidature il s'agit, ou précise-la (applicationId, lu dans l'index de ses objets)." },
};

/** Never in the reply: what each description ends with. */
const NOT_IN_THE_REPLY =
  "Tu ne rédiges jamais ce document toi-même dans ta réponse, pas même un extrait ni un modèle : propose-le avec cet outil, dis ce que tu proposes, et le candidat le lance sous ta réponse.";

const letterSchema = z.object({ applicationId: id.optional(), language: z.enum(DOCUMENT_LANGUAGES).optional() });
const outreachSchema = letterSchema.extend({ channel: z.enum(OUTREACH_CHANNELS).optional() });

const languageArgument = "language : fr ou en ; omis, la langue des documents de la candidature.";

const nameOf = (application: Application) => [application.jobOffer.title, application.jobOffer.employer].filter(Boolean).join(" · ");
const longDate = (language: "fr" | "en", date: Date) => new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(date);
const applicationUrl = (applicationId: string, path: "tailored-cv" | "tailored-documents") => `/api/applications/${encodeURIComponent(applicationId)}/${path}`;

/** A draft's version: when it last changed, by the AI Coach or the Candidate. */
function versionOf(drafts: ApplicationDrafts, document: TailoredDocumentKind): string {
  const draft = document === "cover_letter" ? drafts.coverLetter : drafts.outreachMessage;
  return draft ? draft.updatedAt.toISOString() : NO_DRAFT;
}

export function documentCoachActions(sources: DocumentActionSources): CoachAction[] {
  /** The Candidate's Application `applicationId`, unless it is an Archived Application (its Profile archived): out of reach. */
  async function reachable(candidateId: string, applicationId: string): Promise<Application | null> {
    const [application, profiles] = await Promise.all([sources.applications.get(candidateId, applicationId), sources.profiles.list(candidateId)]);
    return application && profiles.some((profile) => profile.id === application.profile.id && !profile.archived) ? application : null;
  }

  /** The Application the call is about: the one named, else the one In view; undefined when there is neither. */
  const applicationIdOf = (named: string | undefined, call: CoachActionCall) => named ?? (call.inView?.kind === "application" ? call.inView.id : undefined);

  /** The card's common part: the Application, the Result it opens, launched in the Candidate's request. */
  const launched = (application: Application, result: ApplicationResult, run: Omit<NonNullable<ProposedChange["runs"]>, "opens">) => {
    const opens = routes.applicationResult(application.id, result);
    return { target: { kind: "application" as const, id: application.id, name: nameOf(application), href: opens }, value: {}, fields: [], launches: true as const, runs: { ...run, opens } };
  };

  const tailoredCv = defineCoachAction({
    name: DOCUMENT_ACTIONS.tailoredCv,
    description: `Propose de préparer le CV adapté d'une candidature du candidat, quand il le demande (« adapte mon CV à cette offre ») : une proposition tirée de son CV de référence, qu'il relit changement par changement avant de l'enregistrer ; elle ne remplace jamais le CV adapté déjà enregistré. applicationId : omis, la candidature consultée. ${languageArgument} ${NOT_IN_THE_REPLY}`,
    schema: letterSchema,
    group: "documents",
    kind: "propose",
    copiesText: false,
    async run({ applicationId, language }, call) {
      const wanted = applicationIdOf(applicationId, call);
      if (!wanted) return WHICH_APPLICATION;
      const application = await reachable(call.candidateId, wanted);
      const state = application ? await sources.tailoredCvs.get(call.candidateId, application.id) : null;
      if (!application || !state) return NOT_FOUND;
      const { t } = createI18n(call.language);
      const written: DocumentLanguage = language ?? state.documentLanguage;
      const change: ProposedChange = {
        ...launched(application, "tailored_cv", { kind: "tailored_cv", url: applicationUrl(application.id, "tailored-cv"), body: { language: written } }),
        what: t("tailoredCv.tailored"),
        before: state.saved ? t("coachProposals.values.tailoredCvSaved", { date: longDate(call.language, state.saved.savedAt) }) : t("coachProposals.values.noTailoredCv"),
        after: t("coachProposals.values.tailoredCvProposal", { language: t(`tailoredDocuments.languages.${written}`) }),
        version: ANY,
      };
      return { ok: true, data: change, pages: [change.target.href] };
    },
    async apply(change, { candidateId }) {
      return (await reachable(candidateId, change.target.id)) ? { ok: true } : NOT_FOUND;
    },
  });

  /** A Cover Letter's or Outreach Message's proposal: « Rédiger », the draft that exists said to be replaced. */
  const draft = (document: TailoredDocumentKind, name: string, what: (t: ReturnType<typeof createI18n>["t"]) => string, description: string, schema: typeof letterSchema | typeof outreachSchema) =>
    defineCoachAction({
      name,
      description,
      // A Cover Letter's has no channel: its arguments never hold one.
      schema: schema as typeof outreachSchema,
      group: "documents",
      kind: "propose",
      copiesText: false,
      async run({ applicationId, language, channel }, call) {
        const wanted = applicationIdOf(applicationId, call);
        if (!wanted) return WHICH_APPLICATION;
        const application = await reachable(call.candidateId, wanted);
        const drafts = application ? await sources.tailoredDocuments.get(call.candidateId, application.id) : null;
        if (!application || !drafts) return NOT_FOUND;
        const { t } = createI18n(call.language);
        const written: DocumentLanguage = language ?? drafts.documentLanguage;
        const existing = document === "cover_letter" ? drafts.coverLetter : drafts.outreachMessage;
        const edited = existing && existing.updatedAt.getTime() > existing.draftedAt.getTime();
        const result: ApplicationResult = document;
        const change: ProposedChange = {
          ...launched(application, result, { kind: "tailored_documents", url: applicationUrl(application.id, "tailored-documents"), body: { document, language: written, ...(channel ? { channel } : {}) } }),
          what: what(t),
          before: existing ? t(edited ? "coachProposals.values.draftEdited" : "coachProposals.values.draftOf", { date: longDate(call.language, existing.draftedAt) }) : t("coachProposals.values.noDraft"),
          after: t("coachProposals.values.newDraft", { language: t(`tailoredDocuments.languages.${written}`) }),
          version: versionOf(drafts, document),
          ...(existing ? { replaces: t("coachProposals.values.replacesDraft") } : {}),
        };
        return { ok: true, data: change, pages: [change.target.href] };
      },
      async apply(change, { candidateId }) {
        const application = await reachable(candidateId, change.target.id);
        const drafts = application ? await sources.tailoredDocuments.get(candidateId, application.id) : null;
        if (!drafts) return NOT_FOUND;
        // Written or edited since the card was made: not the draft the Candidate confirmed replacing.
        return versionOf(drafts, document) === change.version ? { ok: true } : CONFLICT;
      },
    });

  const coverLetter = draft(
    "cover_letter",
    DOCUMENT_ACTIONS.coverLetter,
    (t) => t("tailoredDocuments.coverLetter.title"),
    `Propose de rédiger la lettre de motivation d'une candidature du candidat, quand il le demande (« écris-moi une lettre ») : un brouillon tiré de son CV de référence et de l'offre, qu'il modifie ensuite. Un brouillon existant, modifications comprises, est remplacé : la carte le lui fait confirmer. applicationId : omis, la candidature consultée. ${languageArgument} ${NOT_IN_THE_REPLY}`,
    letterSchema,
  );

  const outreachMessage = draft(
    "outreach_message",
    DOCUMENT_ACTIONS.outreachMessage,
    (t) => t("tailoredDocuments.outreachMessage.title"),
    `Propose de rédiger le message d'approche d'une candidature du candidat (à un recruteur ou à la personne qui recrute), quand il le demande : un brouillon tiré de son CV de référence et de l'offre, qu'il modifie ensuite. Un brouillon existant, modifications comprises, est remplacé : la carte le lui fait confirmer. applicationId : omis, la candidature consultée. channel : email (par défaut) ou inmail (LinkedIn). ${languageArgument} ${NOT_IN_THE_REPLY}`,
    outreachSchema,
  );

  return [tailoredCv, coverLetter, outreachMessage];
}
