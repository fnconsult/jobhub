/**
 * The Agenda's Coach Actions (#718, ADR-0077): the AI Coach proposes to add, move or cancel an Interview, and the
 * Candidate applies it from its card in the thread, through the Applications module the Interview form and the Agenda
 * use (addInterview, editInterview, cancelInterview), with the same validation.
 *
 *   agendaCoachActions(applications)   // propose_interview, propose_interview_change, propose_interview_cancel
 *
 *  - `propose_interview`: a date and time in French time (Europe/Paris), a duration, a format, a place or link, on one of
 *    the Candidate's Applications. One not at « Entretien » is moved there too, as from the Agenda: one card, both changes
 *    listed. A relative date (« jeudi prochain à 14 h ») is the model's to resolve, from the date of the day the Coach
 *    context gives; the card shows it absolute.
 *  - `propose_interview_change`: a new date (a Reschedule as the hour rule says), format, place or link.
 *  - `propose_interview_cancel`: a Cancelled Agenda Item, which stays on the Agenda.
 * Never the Interview's note (free text the Coach does not write), never a deletion: « Supprimer » on the Interview is for
 * an entry made by mistake, the Candidate's own. None copies text: the place and link are fields of the Interview.
 * « Annuler » puts the state before back: an Interview added is removed (and its Application back at its status), one
 * changed or cancelled is restored, a Reschedule undone within the hour leaving no trace.
 * Archived Profiles' Applications, another Candidate's or an unknown id are `not_found`.
 */
import { INTERVIEW_FORMATS, type ApplicationStatus } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import * as z from "zod";
import { frenchDateTime, INTERVIEW_TIME_ZONE, interviewWallClock, type Application, type ApplicationChangeResult, type Applications, type Interview, type InterviewState } from "../applications";
import { readOrigin } from "../origin";
import { routes } from "../routes";
import { defineCoachAction, type ApplyProposalResult, type CoachAction, type ProposalField, type ProposedChange, type UndoProposalResult } from "./index";

type Translate = ReturnType<typeof createI18n>["t"];

export const AGENDA_ACTIONS = { add: "propose_interview", change: "propose_interview_change", cancel: "propose_interview_cancel" } as const;

/** What the Agenda's Coach Actions call of the Applications module. */
export type AgendaApplications = Pick<
  Applications,
  "list" | "get" | "statusOf" | "change" | "addInterview" | "interviewOf" | "editInterview" | "cancelInterview" | "removeInterview" | "restoreInterview"
>;

/** A date and time as the Interview form takes it, in French time: "2026-11-12T14:00". */
const wallClock = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "AAAA-MM-JJTHH:MM, heure de Paris");
const id = z.string().min(1).max(200);
const interviewFields = {
  scheduledAt: wallClock.describe("Date et heure absolues, heure de Paris, au format AAAA-MM-JJTHH:MM (ex. 2026-11-12T14:00)."),
  durationMinutes: z.number().int().min(1).max(1440).describe("Durée en minutes, si le candidat la donne."),
  format: z.enum(INTERVIEW_FORMATS).describe("video (visio), phone (téléphone) ou on_site (sur place), si le candidat le donne."),
  place: z.string().max(500).describe("Lieu (adresse) ou lien de visio, tel que le candidat le donne."),
};

const RELATIVE_DATES =
  "Une date relative (« jeudi prochain à 14 h », « demain matin ») se calcule à partir de la date du jour donnée dans le contexte : envoie toujours la date absolue, en heure de Paris.";
const NO_DELETE =
  "Tu ne supprimes jamais un entretien : si le candidat veut supprimer un entretien saisi par erreur, dis-lui d'ouvrir l'entretien dans la section Entretiens de sa candidature et d'utiliser « Supprimer » ; s'il n'aura pas lieu, propose plutôt de l'annuler.";

/** An Interview's card text, in `language`: its absolute date in French time, duration, format and place. */
function interviewText(t: Translate, language: "fr" | "en", interview: Pick<Interview, "scheduledAt" | "durationMinutes" | "format" | "place">): string {
  const when = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", { timeZone: INTERVIEW_TIME_ZONE, dateStyle: "full", timeStyle: "short" }).format(interview.scheduledAt);
  return [
    when,
    interview.durationMinutes ? t("coachProposals.interview.minutes", { count: interview.durationMinutes }) : "",
    interview.format ? t(`interviewFormats.${interview.format}`) : "",
    interview.place,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The Interview form's fields, as « Modifier avant d'appliquer » shows them. */
function formFields(t: Translate): ProposalField[] {
  return [
    { name: "scheduledAt", label: t("application.interviewDate"), type: "datetime" },
    { name: "durationMinutes", label: t("application.interviewDuration"), type: "number" },
    {
      name: "format",
      label: t("application.interviewFormat"),
      type: "select",
      options: [{ value: "", label: t("application.interviewFormatNone") }, ...INTERVIEW_FORMATS.map((format) => ({ value: format, label: t(`interviewFormats.${format}`) }))],
    },
    { name: "place", label: t("application.interviewPlace"), type: "text" },
  ];
}

/** An Interview as the form holds it: every value as text, "" for nothing said. */
const formValue = (interview: Pick<Interview, "scheduledAt" | "durationMinutes" | "format" | "place">): Record<string, string> => ({
  scheduledAt: interviewWallClock(interview.scheduledAt),
  durationMinutes: interview.durationMinutes ? String(interview.durationMinutes) : "",
  format: interview.format ?? "",
  place: interview.place,
});

/** What the form's value sends to the Applications module, as the Interview form sends it: a duration typed as digits goes as a number. */
function interviewInput(value: Record<string, string>) {
  const duration = (value.durationMinutes ?? "").trim();
  return {
    scheduledAt: value.scheduledAt ?? "",
    durationMinutes: duration === "" ? null : /^\d+$/.test(duration) ? Number(duration) : duration,
    format: value.format ? value.format : null,
    place: value.place ?? "",
  };
}

/** The instant a form's date and time stands for, read as the Interview form reads it (French time); null when it does not read. */
function fromWallClock(value: string): Date | null {
  const parsed = frenchDateTime.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const applicationName = (application: Pick<Application, "jobOffer">) => [application.jobOffer.title, application.jobOffer.employer].filter(Boolean).join(" · ");

const refused = (changed: Exclude<ApplicationChangeResult, { ok: true }> | { ok: false; error: "not_in_interview" }): Exclude<ApplyProposalResult, { ok: true }> =>
  "errors" in changed ? { ok: false, error: "invalid", errors: changed.errors } : { ok: false, error: changed.error === "not_found" ? "not_found" : "conflict" };
const undone = (changed: ApplicationChangeResult): UndoProposalResult => (changed.ok ? { ok: true } : { ok: false, error: "error" in changed && changed.error === "not_found" ? "not_found" : "conflict" });

/** An InterviewState as an Action Card keeps it (JSON), and back. */
const keptInterview = z.object({
  id: z.string(),
  scheduledAt: z.coerce.date(),
  note: z.string(),
  durationMinutes: z.number().nullable(),
  format: z.enum(INTERVIEW_FORMATS).nullable(),
  place: z.string(),
  cancelledAt: z.coerce.date().nullable(),
  origin: z.unknown().optional(),
});
const keptState = z.object({ interview: keptInterview, version: z.string(), dateSetAt: z.coerce.date().nullable() });
const stateFrom = (kept: z.output<typeof keptState>): InterviewState => {
  const { origin: storedOrigin, ...fields } = kept.interview;
  const interview: Interview = { ...fields, reschedules: [] };
  const origin = readOrigin(storedOrigin);
  if (origin) interview.origin = origin;
  return { interview, version: kept.version, dateSetAt: kept.dateSetAt };
};

/** What « Annuler » needs for an Interview added: which one, as applying left it, and the Application Status before. */
const addedUndo = z.object({
  applicationId: z.string(),
  interviewId: z.string(),
  version: z.string(),
  status: z.object({ before: z.string(), origin: z.unknown(), version: z.string() }).nullable(),
});
/** What « Annuler » needs for an Interview changed or cancelled: the state before, and the version applying left. */
const changedUndo = z.object({ applicationId: z.string(), interviewId: z.string(), before: keptState, version: z.string() });

export function agendaCoachActions(applications: AgendaApplications): CoachAction[] {
  /** The Candidate's Application, unless its Profile is archived. */
  async function activeApplication(candidateId: string, applicationId: string): Promise<Application | null> {
    const summary = (await applications.list(candidateId)).find((each) => each.id === applicationId);
    if (!summary || summary.profile.archived) return null;
    return applications.get(candidateId, applicationId);
  }

  /** One of the Candidate's Interviews, on an Application whose Profile is active, with its card's target. */
  async function interviewOf(candidateId: string, applicationId: string, interviewId: string) {
    const application = await activeApplication(candidateId, applicationId);
    const state = application ? await applications.interviewOf(candidateId, applicationId, interviewId) : null;
    if (!application || !state) return null;
    return { application, state, target: targetOf(application) };
  }

  const targetOf = (application: Application): ProposedChange["target"] => ({
    kind: "application",
    id: application.id,
    name: applicationName(application),
    href: routes.applicationSection(application.id, "entretiens"),
  });

  /** « Annuler » an Interview changed or cancelled: back as it was, from the version applying it left. */
  async function restore(undo: unknown, candidateId: string): Promise<UndoProposalResult> {
    const kept = changedUndo.safeParse(undo);
    if (!kept.success) return { ok: false, error: "not_found" };
    const { applicationId, interviewId, before, version } = kept.data;
    return undone(await applications.restoreInterview(candidateId, applicationId, interviewId, stateFrom(before), { version }));
  }

  /** What « Annuler » keeps of an Interview changed: its state before, and its version now. */
  async function changedUndoOf(candidateId: string, applicationId: string, interviewId: string, before: InterviewState) {
    const after = await applications.interviewOf(candidateId, applicationId, interviewId);
    return { applicationId, interviewId, before, version: after?.version ?? "" };
  }

  return [
    defineCoachAction({
      name: AGENDA_ACTIONS.add,
      description: [
        "Propose d'ajouter un entretien à une candidature du candidat (applicationId : l'id de la candidature, trouvé avec list_objects au besoin), à une date et heure absolues en heure de Paris, avec sa durée, son format et son lieu ou lien quand le candidat les donne.",
        "Si la candidature n'est pas au statut Entretien, la proposition l'y passe aussi.",
        RELATIVE_DATES,
        "Ne propose pas de note sur l'entretien.",
      ].join(" "),
      schema: z.object({
        applicationId: id,
        scheduledAt: interviewFields.scheduledAt,
        durationMinutes: interviewFields.durationMinutes.optional(),
        format: interviewFields.format.optional(),
        place: interviewFields.place.optional(),
      }),
      group: "agenda",
      kind: "propose",
      copiesText: false,
      async run({ applicationId, scheduledAt, durationMinutes, format, place }, { candidateId, language }) {
        const application = await activeApplication(candidateId, applicationId);
        const state = application ? await applications.statusOf(candidateId, applicationId) : null;
        const at = fromWallClock(scheduledAt);
        if (!application || !state || !at) return { ok: false, error: "not_found" };
        const { t } = createI18n(language);
        const interview = { scheduledAt: at, durationMinutes: durationMinutes ?? null, format: format ?? null, place: place?.trim() ?? "" };
        const label = (status: ApplicationStatus) => t(`applicationStatuses.${status}`);
        const change: ProposedChange = {
          target: targetOf(application),
          what: t("coachProposals.fields.newInterview"),
          before: t("coachProposals.interview.none"),
          after: interviewText(t, language, interview),
          ...(state.status === "interview" ? {} : { also: [{ what: t("coachProposals.fields.applicationStatus"), before: label(state.status), after: label("interview") }] }),
          value: { ...formValue(interview), scheduledAt },
          fields: formFields(t),
          version: state.version,
        };
        return { ok: true, data: change, pages: [routes.applicationSection(applicationId, "entretiens")] };
      },
      async apply(change, { candidateId, cardId, at }) {
        const applicationId = change.target.id;
        const before = await applications.statusOf(candidateId, applicationId);
        if (!before) return { ok: false, error: "not_found" };
        const added = await applications.addInterview(
          candidateId,
          applicationId,
          { ...interviewInput(change.value), moveToInterview: true },
          { version: change.version, origin: { origin: "coach_proposal", cardId, appliedAt: at } },
        );
        if (!added.ok) return refused(added);
        const [interview, status] = await Promise.all([applications.interviewOf(candidateId, applicationId, added.interviewId), applications.statusOf(candidateId, applicationId)]);
        const moved = before.status !== "interview";
        return {
          ok: true,
          undo: {
            applicationId,
            interviewId: added.interviewId,
            version: interview?.version ?? "",
            status: moved ? { before: before.status, origin: before.origin, version: status?.version ?? "" } : null,
          } satisfies z.input<typeof addedUndo>,
        };
      },
      async undo(undo, { candidateId }) {
        const kept = addedUndo.safeParse(undo);
        if (!kept.success) return { ok: false, error: "not_found" };
        const { applicationId, interviewId, version, status } = kept.data;
        // Both as applying left them, or nothing is undone.
        if (status && (await applications.statusOf(candidateId, applicationId))?.version !== status.version) return { ok: false, error: "conflict" };
        const removed = await applications.removeInterview(candidateId, applicationId, interviewId, { version });
        if (!removed.ok || !status) return undone(removed);
        return undone(await applications.change(candidateId, applicationId, { status: status.before }, { version: status.version, origin: readOrigin(status.origin) }));
      },
    }),

    defineCoachAction({
      name: AGENDA_ACTIONS.change,
      description: [
        "Propose de modifier un entretien du candidat (applicationId et interviewId, trouvés avec list_objects : type agenda_item) : une nouvelle date et heure absolues en heure de Paris (un report), sa durée, son format ou son lieu ou lien. N'envoie que ce qui change.",
        RELATIVE_DATES,
        "Ne propose pas de note sur l'entretien.",
        NO_DELETE,
      ].join(" "),
      schema: z
        .object({
          applicationId: id,
          interviewId: id,
          scheduledAt: interviewFields.scheduledAt.optional(),
          durationMinutes: interviewFields.durationMinutes.optional(),
          format: interviewFields.format.optional(),
          place: interviewFields.place.optional(),
        })
        .refine((args) => args.scheduledAt !== undefined || args.durationMinutes !== undefined || args.format !== undefined || args.place !== undefined, "Rien à modifier."),
      group: "agenda",
      kind: "propose",
      copiesText: false,
      async run({ applicationId, interviewId, scheduledAt, durationMinutes, format, place }, { candidateId, language }) {
        const found = await interviewOf(candidateId, applicationId, interviewId);
        const at = scheduledAt === undefined ? null : fromWallClock(scheduledAt);
        if (!found || found.state.interview.cancelledAt || (scheduledAt !== undefined && !at)) return { ok: false, error: "not_found" };
        const { t } = createI18n(language);
        const before = found.state.interview;
        const after = {
          scheduledAt: at ?? before.scheduledAt,
          durationMinutes: durationMinutes ?? before.durationMinutes,
          format: format ?? before.format,
          place: place?.trim() ?? before.place,
        };
        const change: ProposedChange = {
          target: found.target,
          what: t("coachProposals.fields.interview"),
          before: interviewText(t, language, before),
          after: interviewText(t, language, after),
          // Which Interview goes with what applying sends; the form's fields are the rest.
          value: { ...formValue(after), interviewId },
          fields: formFields(t),
          version: found.state.version,
        };
        return { ok: true, data: change, pages: [routes.applicationSection(applicationId, "entretiens")] };
      },
      async apply(change, call) {
        return applyToInterview(change, call, (candidateId, applicationId, interviewId, options) =>
          applications.editInterview(candidateId, applicationId, interviewId, interviewInput(change.value), options),
        );
      },
      async undo(undo, { candidateId }) {
        return restore(undo, candidateId);
      },
    }),

    defineCoachAction({
      name: AGENDA_ACTIONS.cancel,
      description: [
        "Propose d'annuler un entretien du candidat qui n'aura pas lieu (applicationId et interviewId, trouvés avec list_objects : type agenda_item) : il reste dans l'agenda, barré.",
        NO_DELETE,
      ].join(" "),
      schema: z.object({ applicationId: id, interviewId: id }),
      group: "agenda",
      kind: "propose",
      copiesText: false,
      async run({ applicationId, interviewId }, { candidateId, language }) {
        const found = await interviewOf(candidateId, applicationId, interviewId);
        if (!found || found.state.interview.cancelledAt) return { ok: false, error: "not_found" };
        const { t } = createI18n(language);
        const change: ProposedChange = {
          target: found.target,
          what: t("coachProposals.fields.interview"),
          before: interviewText(t, language, found.state.interview),
          after: t("coachProposals.interview.cancelled"),
          value: { interviewId },
          fields: [],
          version: found.state.version,
        };
        return { ok: true, data: change, pages: [routes.applicationSection(applicationId, "entretiens")] };
      },
      async apply(change, call) {
        return applyToInterview(change, call, (candidateId, applicationId, interviewId, options) => applications.cancelInterview(candidateId, applicationId, interviewId, options));
      },
      async undo(undo, { candidateId }) {
        return restore(undo, candidateId);
      },
    }),
  ];

  /**
   * Applies a change to an Interview through `change` from the version the proposal saw, the Interview keeping the card as
   * its Origin; gives back what « Annuler » needs.
   */
  async function applyToInterview(
    proposed: ProposedChange,
    { candidateId, cardId, at }: { candidateId: string; cardId: string; at: Date },
    change: (candidateId: string, applicationId: string, interviewId: string, options: { version: string; origin: { origin: "coach_proposal"; cardId: string; appliedAt: Date } }) => Promise<ApplicationChangeResult>,
  ): Promise<ApplyProposalResult> {
    const applicationId = proposed.target.id;
    const interviewId = proposed.value.interviewId;
    if (!interviewId) return { ok: false, error: "not_found" };
    const before = await applications.interviewOf(candidateId, applicationId, interviewId);
    if (!before) return { ok: false, error: "not_found" };
    if (before.version !== proposed.version) return { ok: false, error: "conflict" };
    const changed = await change(candidateId, applicationId, interviewId, { version: proposed.version, origin: { origin: "coach_proposal", cardId, appliedAt: at } });
    if (!changed.ok) return refused(changed);
    return { ok: true, undo: await changedUndoOf(candidateId, applicationId, interviewId, before) };
  }
}
