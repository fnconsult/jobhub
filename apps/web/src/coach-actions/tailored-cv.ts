/**
 * The Tailored CV reworked from the Coach Conversation (ADR-0113, #1097): asked « Reformulate the skills in a list », the
 * AI Coach reads the whole Tailored CV and proposes changes section by section on a card. The card opens the review in
 * the conversation's Work Pane, each change accepted or rejected on its own (ADR-0006); only the accepted ones are sent.
 *  - `read_tailored_cv`: the saved Tailored CV and the proposal under review, section by section (no identity block),
 *    with the proposal's open questions. Untrusted (`untrusted: true`): written from the Job Offer.
 *  - `propose_tailored_cv_changes`: the same edits as the Master CV's (`propose_master_cv_changes`), on the proposal under
 *    review (its answers kept, never proposed again) or else the saved Tailored CV (its next version, the card as its
 *    Origin). Never an item nor a figure the Tailored CV or its Master CV does not say, unless a Declared Fact the
 *    Candidate stated in the conversation (« Fait déclaré par vous »; not declared: `not_declared` with the Typed redirect
 *    to the Master CV's section). A change with words of the Job Offer the CVs lack is marked « Reprend les mots de
 *    l'offre », waiting for an explicit accept. A review that only lays the CV out is a Layout-only Change (« Mise en forme
 *    seule, aucun mot ajouté »). Offered whatever is In view (`sentByCandidate`, ADR-0113). « Annuler »: a Restore of the
 *    version before, or the proposal's adaptation put back, while nothing changed since.
 *  - `propose_tailored_cv_answers`: a card « Réponses aux questions » filling the proposal's answers the Candidate stated in
 *    the conversation (each checked in their own messages); the AI Coach never accepts nor rejects a change. « Annuler »
 *    puts the answers before back.
 * Each is scoped to the session's Candidate: another's id, an Archived Application (its Profile archived) or an unknown id
 * is `not_found`.
 *
 *   tailoredCvCoachActions({ applications, profiles, tailoredCvs, tailoredDocumentVersions })
 */
import { normalise, type CvContent } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import { asData } from "../coach/context";
import type { Origin } from "../origin";
import type { Profiles } from "../profiles";
import { acceptedCvEdits, isDeclared, masterCvReview } from "../profiles/master-cv-proposal";
import { routes } from "../routes";
import type { CvOrigins, RevisableTailoredCv, TailoredCvQuestion, TailoredCvs } from "../tailored-cv";
import { layoutOnly } from "../tailored-cv/changes";
import type { TailoredDocumentVersions } from "../tailored-documents/versions";
import { cvEditRefusal } from "./cv-edits";
import { defineCoachAction, masterCvEditSchema, type ApplyProposalResult, type CoachAction, type CoachActionCall, type CoachActionResult, type ProposedChange, type UndoProposalResult } from "./index";
import { fitted } from "./reads";

export const TAILORED_CV_ACTIONS = {
  read: "read_tailored_cv",
  changes: "propose_tailored_cv_changes",
  answers: "propose_tailored_cv_answers",
} as const;

/** The domain modules these Coach Actions go through, each scoped to the Candidate. */
export interface TailoredCvActionSources {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "list">;
  tailoredCvs: Pick<TailoredCvs, "revisable" | "reviseSaved" | "reviseProposal" | "answerAll">;
  tailoredDocumentVersions: Pick<TailoredDocumentVersions, "restore">;
}

const NOT_FOUND = { ok: false, error: "not_found" } as const;
const CONFLICT = { ok: false, error: "conflict" } as const;
const id = z.string().min(1).max(200);

const WHICH_APPLICATION: CoachActionResult = {
  ok: true,
  proposes: false,
  data: { message: "Aucune candidature n'est consultée : demande au candidat de quelle candidature il s'agit, ou précise-la (applicationId, lu dans l'index de ses objets)." },
};
const NO_TAILORED_CV = "Cette candidature n'a pas encore de CV adapté, ni enregistré ni en relecture : propose de le préparer avec propose_tailored_cv.";
const NO_PROPOSAL = "Aucune proposition de CV adapté n'est en relecture : ses questions n'existent pas. Pour en préparer une, propose propose_tailored_cv.";

const nameOf = (application: Application) => [application.jobOffer.title, application.jobOffer.employer].filter(Boolean).join(" · ");

/**
 * The version a card keeps of the proposal under review: its revision cut to 16 characters. The revision is an md5, which
 * the reply's key check takes for a credential when copied from a tool result (#774).
 */
const short = (revision: string) => revision.slice(0, 16);

/** A CV section by section, as the AI Coach reads it: no identity block. */
function cvText(cv: CvContent): string {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  return [
    `Titre : ${cv.headline}`,
    `Résumé : ${cv.summary}`,
    `Expériences :\n${cv.experience.map((job) => [`- ${[job.title, job.employer, job.period, job.location].filter(Boolean).join(" · ")}`, job.description].filter(Boolean).join("\n  ")).join("\n")}`,
    `Formation :\n${list(cv.education.map((item) => [item.degree, item.institution, item.year].filter(Boolean).join(" · ")))}`,
    `Compétences :\n${list(cv.skills)}`,
    `Langues :\n${list(cv.languages.map((item) => [item.name, item.level].filter(Boolean).join(" · ")))}`,
  ].join("\n");
}

const ANSWER: Record<"fr" | "en", Record<"confirmed" | "declined" | "none", string>> = {
  fr: { confirmed: "oui", declined: "non", none: "sans réponse" },
  en: { confirmed: "yes", declined: "no", none: "no answer" },
};
const answersLine = (questions: readonly TailoredCvQuestion[], language: "fr" | "en") =>
  questions.map((question) => `${question.requirement} : ${ANSWER[language][question.answer ?? "none"]}`).join(" · ");

/** Where an item of the edited CV comes from in the Master CV: through the proposal's own origins; null without them. */
function composed(traced: Required<CvOrigins>, base: CvOrigins | null): CvOrigins | null {
  if (!base) return null;
  const through = (section: keyof CvOrigins) => {
    const from = base[section];
    return from ? traced[section].map((origin) => (origin < 0 ? -1 : (from[origin] ?? -1))) : undefined;
  };
  const experience = through("experience");
  return { ...(experience ? { experience } : {}), education: through("education") ?? [], skills: through("skills") ?? [], languages: through("languages") ?? [] };
}

const BASES = ["saved", "proposal"] as const;
type Base = (typeof BASES)[number];

/** What a Tailored CV change applies to: the proposal under review first, else the saved Tailored CV. */
function baseOf(revisable: RevisableTailoredCv, wanted?: Base) {
  const { proposal, saved } = revisable;
  if (proposal && wanted !== "saved") return { base: "proposal" as const, content: proposal.adapted, reference: proposal.master, version: short(proposal.revision), proposal };
  if (saved && wanted !== "proposal") return { base: "saved" as const, content: saved.content, reference: saved.master, version: String(saved.version), proposal: null };
  return null;
}

const changesUndo = z.discriminatedUnion("base", [
  z.object({ applicationId: z.string(), base: z.literal("saved"), before: z.number().int().min(1), version: z.number().int().min(1) }),
  z.object({ applicationId: z.string(), base: z.literal("proposal"), revision: z.string(), before: z.object({ adapted: z.any(), origins: z.any(), declared: z.array(z.string()) }) }),
]);
const answersUndo = z.object({ applicationId: z.string(), revision: z.string(), before: z.array(z.object({ requirement: z.string(), answer: z.enum(["confirmed", "declined"]).nullable() })) });

export function tailoredCvCoachActions(sources: TailoredCvActionSources): CoachAction[] {
  /** The Candidate's Application `applicationId`, unless it is an Archived Application (its Profile archived). */
  async function reachable(candidateId: string, applicationId: string): Promise<Application | null> {
    const [application, profiles] = await Promise.all([sources.applications.get(candidateId, applicationId), sources.profiles.list(candidateId)]);
    return application && profiles.some((profile) => profile.id === application.profile.id && !profile.archived) ? application : null;
  }
  const applicationIdOf = (named: string | undefined, call: CoachActionCall) => named ?? (call.inView?.kind === "application" ? call.inView.id : undefined);
  /** The Application and what a change applies to, for a call. */
  async function revisableOf(named: string | undefined, call: CoachActionCall) {
    const wanted = applicationIdOf(named, call);
    if (!wanted) return "which" as const;
    const application = await reachable(call.candidateId, wanted);
    const revisable = application ? await sources.tailoredCvs.revisable(call.candidateId, application.id) : null;
    return application && revisable ? { application, revisable } : null;
  }

  const read = defineCoachAction({
    name: TAILORED_CV_ACTIONS.read,
    description:
      "Lit en entier le CV adapté d'une candidature du candidat, rubrique par rubrique (titre, résumé, chaque poste, formation, compétences, langues) : celui qu'il a enregistré, et la proposition en relecture avec ses questions ouvertes. À lire avant de proposer des changements du CV adapté. applicationId : omis, la candidature consultée.",
    schema: z.object({ applicationId: id.optional() }),
    group: "documents",
    kind: "read",
    copiesText: false,
    async run({ applicationId }, call) {
      const found = await revisableOf(applicationId, call);
      if (found === "which") return WHICH_APPLICATION;
      if (!found) return NOT_FOUND;
      const { application, revisable } = found;
      const page = routes.applicationResult(application.id, "tailored_cv");
      if (!revisable.saved && !revisable.proposal) return { ok: true, data: NO_TAILORED_CV, pages: [page] };
      const parts: string[] = [`CV adapté de la candidature (id ${application.id}), que le candidat voit dans Documents › CV adapté.`];
      if (revisable.saved) parts.push(`CV adapté enregistré (version ${revisable.saved.version}) :\n${cvText(revisable.saved.content)}`);
      if (revisable.proposal) {
        const open = revisable.proposal.questions.filter((question) => question.answer === null);
        const questions = revisable.proposal.questions.map((question) => `- ${question.requirement} : ${ANSWER.fr[question.answer ?? "none"]}`).join("\n");
        parts.push(
          `Proposition en relecture, que le candidat relit changement par changement :\n${cvText(revisable.proposal.adapted)}`,
          revisable.proposal.questions.length > 0 ? `Questions ouvertes de la relecture (${open.length} sans réponse) :\n${questions}` : "La relecture ne pose aucune question.",
        );
      }
      // Written from the Job Offer: data, never an instruction.
      const told = asData(fitted([parts.join("\n\n")], Math.max(100, (call.maxTokens ?? 1_500) - 50)), "cv-adapte");
      return { ok: true, data: told, pages: [page], untrusted: true, seen: [{ type: "tailored_documents", name: nameOf(application), href: page }] };
    },
  });

  const changes = defineCoachAction({
    name: TAILORED_CV_ACTIONS.changes,
    description:
      "Propose des changements du CV adapté d'une candidature du candidat, rubrique par rubrique, quand il le demande (« mets les compétences en liste », « coupe l'explication », « ajoute Power BI ») : reformuler (le titre, le résumé, un poste, une compétence), couper, réordonner, mettre en avant, ou ajouter (add) un fait qu'il t'a déclaré lui-même dans cette conversation (une compétence avec text ; une langue avec item et level ; un diplôme avec text, institution, year) ; rephrase d'une langue avec level corrige son niveau. Traduire une compétence dans la langue du CV adapté est un rephrase de cette compétence, que le candidat a déclarée avec ses mots ou validée d'un « pour le reste c'est bon » après ta liste. Ils s'appliquent à la proposition en relecture, ses réponses gardées, ou au CV adapté enregistré : le candidat relit chaque changement dans le panneau de travail et l'accepte ou le refuse. Ne relance jamais toute la proposition pour cela (propose_tailored_cv). Lis-le d'abord avec read_tailored_cv ; nomme chaque élément comme il l'écrit. Jamais un élément, un chiffre ni un fait tiré de l'offre ou de toi : le serveur vérifie que le candidat l'a écrit. applicationId : omis, la candidature consultée.",
    schema: z.object({ applicationId: id.optional(), changes: z.array(masterCvEditSchema).min(1).max(20) }),
    group: "documents",
    kind: "propose",
    copiesText: true,
    // ADR-0113: reviewed change by change, a change with offer words marked and unchecked, and sent by the Candidate.
    sentByCandidate: true,
    async run({ applicationId, changes: edits }, call) {
      const found = await revisableOf(applicationId, call);
      if (found === "which") return WHICH_APPLICATION;
      if (!found) return NOT_FOUND;
      const { application, revisable } = found;
      const base = baseOf(revisable);
      if (!base) return { ok: true, proposes: false, data: { message: NO_TAILORED_CV } };
      const offers = [`${application.jobOffer.title} ${application.jobOffer.content}`];
      const review = masterCvReview(base.content, edits, { offers, declared: call.said ?? [], ...(call.approved ? { approved: call.approved } : {}), reference: base.reference });
      if (!review.ok) return cvEditRefusal(review, "le CV adapté");
      const { t } = createI18n(call.language);
      const page = routes.applicationResult(application.id, "tailored_cv");
      const change: ProposedChange = {
        target: { kind: "application", id: application.id, name: nameOf(application), href: page },
        what: t("tailoredCv.tailored"),
        before: base.base === "saved" ? t("coachProposals.tailoredCvChanges.saved", { version: base.version }) : t("coachProposals.tailoredCvChanges.proposal"),
        after: t("coachProposals.masterCv.changes", { count: review.changes.length }),
        value: { base: base.base },
        fields: [],
        version: base.version,
        review: { changes: review.changes, edits: review.edits },
        ...(layoutOnly(review.changes) ? { layoutOnly: true as const } : {}),
      };
      return { ok: true, data: change, pages: [page] };
    },
    async apply(change, call): Promise<ApplyProposalResult> {
      if (!change.review) return NOT_FOUND;
      // The accepted changes are sent with « Enregistrer », never inferred (ADR-0006): none, nothing to save.
      const ids = new Set(change.review.changes.map((each) => each.id));
      const accepted = (call.accepted ?? []).filter((each) => ids.has(each));
      if (accepted.length === 0) return { ok: false, error: "invalid", errors: [{ field: "accepted", code: "required" }] };
      const application = await reachable(call.candidateId, change.target.id);
      const revisable = application ? await sources.tailoredCvs.revisable(call.candidateId, application.id) : null;
      const wanted = BASES.find((each) => each === change.value.base);
      if (!application || !revisable || !wanted) return NOT_FOUND;
      const base = baseOf(revisable, wanted);
      // Proposed again, answered or saved since the card was made: not the CV the Candidate reviewed the changes on.
      if (!base || base.version !== change.version) return CONFLICT;
      // Its Declared Facts were checked when the card was made, against the Candidate's own messages.
      const edited = acceptedCvEdits(base.content, change.review.edits, accepted, { declared: true, reference: base.reference });
      if (!edited) return CONFLICT;
      if (base.base === "saved") {
        const origin: Origin = { origin: "coach_proposal", cardId: call.cardId, appliedAt: call.at };
        const saved = await sources.tailoredCvs.reviseSaved(call.candidateId, application.id, { version: Number(base.version), content: edited.content }, { origin });
        if (!saved.ok) return { ok: false, error: saved.error };
        return { ok: true, undo: { applicationId: application.id, base: "saved", before: saved.before, version: saved.version } };
      }
      const facts = change.review.changes.filter((each) => each.declared && accepted.includes(each.id)).map((each) => (each.kind === "added" ? each.item : each.tailored) ?? "");
      const revised = await sources.tailoredCvs.reviseProposal(call.candidateId, application.id, {
        revision: base.proposal.revision,
        adapted: edited.content,
        origins: composed(edited.origins, base.proposal.origins),
        declared: [...base.proposal.declared, ...facts.filter(Boolean)],
      });
      if (!revised.ok) return { ok: false, error: revised.error };
      return { ok: true, undo: { applicationId: application.id, base: "proposal", revision: revised.revision, before: revised.before } };
    },
    async undo(undo, { candidateId }): Promise<UndoProposalResult> {
      const kept = changesUndo.safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      if (kept.data.base === "saved") {
        const { applicationId, before, version } = kept.data;
        // A Restore of the version before: a new version, the history kept; changed since, a conflict.
        const restored = await sources.tailoredDocumentVersions.restore(candidateId, applicationId, { document: "tailored_cv", version: before }, { current: version });
        if (restored.ok) return { ok: true };
        return "errors" in restored ? NOT_FOUND : { ok: false, error: restored.error };
      }
      const { applicationId, revision, before } = kept.data;
      const put = await sources.tailoredCvs.reviseProposal(candidateId, applicationId, { revision, adapted: before.adapted as CvContent, origins: (before.origins ?? null) as CvOrigins | null, declared: before.declared });
      return put.ok ? { ok: true } : { ok: false, error: put.error };
    },
  });

  const answers = defineCoachAction({
    name: TAILORED_CV_ACTIONS.answers,
    description:
      "Propose de remplir les réponses aux questions de la proposition de CV adapté en relecture (« Avez-vous cette compétence : Power BI ? »), avec ce que le candidat t'a dit lui-même dans cette conversation : confirmed true s'il l'a, false s'il ne l'a pas. Chaque question nommée comme read_tailored_cv l'écrit ; le serveur vérifie qu'il l'a écrite dans un de ses messages. Tu n'acceptes ni ne refuses jamais un changement pour lui. applicationId : omis, la candidature consultée.",
    schema: z.object({
      applicationId: id.optional(),
      answers: z.array(z.object({ requirement: z.string().trim().min(1).max(200), confirmed: z.boolean() })).min(1).max(8),
    }),
    group: "documents",
    kind: "propose",
    copiesText: false,
    async run({ applicationId, answers: given }, call) {
      const found = await revisableOf(applicationId, call);
      if (found === "which") return WHICH_APPLICATION;
      if (!found) return NOT_FOUND;
      const { application, revisable } = found;
      const proposal = revisable.proposal;
      if (!proposal) return { ok: true, proposes: false, data: { message: NO_PROPOSAL } };
      const asked: TailoredCvQuestion[] = [];
      for (const answer of given) {
        const question = proposal.questions.find((each) => normalise(each.requirement) === normalise(answer.requirement));
        if (!question)
          return { ok: false, error: "refused", reason: `« ${answer.requirement} » n'est pas une question de la relecture. Ses questions : ${proposal.questions.map((each) => each.requirement).join(", ")}.` };
        // The Candidate's answer, said in their own words in this conversation (ADR-0113): never guessed.
        if (!isDeclared(question.requirement, call.said ?? []))
          return {
            ok: false,
            error: "refused",
            reason: `Le candidat n'a pas parlé de « ${question.requirement} » dans cette conversation (not_declared) : demande-lui s'il l'a, et ne propose sa réponse qu'une fois qu'il te l'a dite.`,
          };
        if (!asked.some((each) => each.requirement === question.requirement)) asked.push({ requirement: question.requirement, answer: answer.confirmed ? "confirmed" : "declined" });
      }
      const { t } = createI18n(call.language);
      const page = routes.applicationResult(application.id, "tailored_cv");
      const change: ProposedChange = {
        target: { kind: "application", id: application.id, name: nameOf(application), href: page },
        what: t("coachProposals.tailoredCvAnswers.what"),
        before: answersLine(
          asked.map((each) => proposal.questions.find((question) => question.requirement === each.requirement)!),
          call.language,
        ),
        after: answersLine(asked, call.language),
        value: Object.fromEntries(asked.map((each) => [each.requirement, each.answer!])),
        fields: [],
        version: short(proposal.revision),
      };
      return { ok: true, data: change, pages: [page] };
    },
    async apply(change, call): Promise<ApplyProposalResult> {
      const application = await reachable(call.candidateId, change.target.id);
      const proposal = application ? (await sources.tailoredCvs.revisable(call.candidateId, application.id))?.proposal : null;
      if (!application || !proposal) return NOT_FOUND;
      if (short(proposal.revision) !== change.version) return CONFLICT;
      const given = Object.entries(change.value).flatMap(([requirement, answer]): TailoredCvQuestion[] => (answer === "confirmed" || answer === "declined" ? [{ requirement, answer }] : []));
      const answered = await sources.tailoredCvs.answerAll(call.candidateId, application.id, { revision: proposal.revision, answers: given });
      if (!answered.ok) return { ok: false, error: answered.error };
      return { ok: true, undo: { applicationId: application.id, revision: answered.revision, before: answered.before } };
    },
    async undo(undo, { candidateId }): Promise<UndoProposalResult> {
      const kept = answersUndo.safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      const { applicationId, revision, before } = kept.data;
      const put = await sources.tailoredCvs.answerAll(candidateId, applicationId, { revision, answers: before });
      return put.ok ? { ok: true } : { ok: false, error: put.error };
    },
  });

  return [read, changes, answers];
}
