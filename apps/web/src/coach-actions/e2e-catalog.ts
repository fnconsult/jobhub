/**
 * The e2e suite's fake Coach Action (#715): proposes an Application Status, applied and put back through the Applications
 * module, so a Coach proposal's card can be played end to end (proposal → « Appliquer » → « Annuler », its « Origine »)
 * on its own, apart from the Candidatures Coach Actions shipped since (#716, ./applications.ts); and a slow read of an
 * Application (#788), so a Coach Action's step is seen live. Added to the catalogue on an e2e spec's own server only
 * (JOBHUB_TARGET=e2e and E2E_FAKE_COACH_ACTIONS=1, ./server.ts); never shipped, never offered elsewhere.
 */
import { APPLICATION_STATUSES, type ApplicationStatus } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import * as z from "zod";
import type { ApplicationChangeResult, Applications } from "../applications";
import { readOrigin } from "../origin";
import { routes } from "../routes";
import { defineCoachAction, type ApplyProposalResult, type CoachAction, type ProposedChange } from "./index";

export const E2E_STATUS_ACTION = "e2e_proposer_statut";
/** Reads an Application after `ms` (#788): a Coach Action slow enough for its step to be seen live in the conversation. */
export const E2E_SLOW_READ_ACTION = "e2e_lire_lentement";

/** Waits `ms`, or until the reply is stopped. */
const after = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((done, failed) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      failed(signal.reason);
    });
  });

/** What « Annuler » needs: the status before, its Origin, and the version applying it left. */
const undoSchema = z.object({ applicationId: z.string(), status: z.enum(APPLICATION_STATUSES), origin: z.unknown(), version: z.string() });

const refused = (changed: Exclude<ApplicationChangeResult, { ok: true }>): Exclude<ApplyProposalResult, { ok: true }> =>
  "errors" in changed ? { ok: false, error: "invalid", errors: changed.errors } : { ok: false, error: changed.error === "conflict" ? "conflict" : "not_found" };

export function e2eCoachActions(applications: Pick<Applications, "get" | "statusOf" | "change">): CoachAction[] {
  return [
    defineCoachAction({
      name: E2E_STATUS_ACTION,
      description: "Propose un nouveau statut pour une candidature du candidat.",
      schema: z.object({ id: z.string().min(1), status: z.enum(APPLICATION_STATUSES) }),
      group: "applications",
      kind: "propose",
      copiesText: false,
      async run({ id, status }, { candidateId, language }) {
        const [application, state] = await Promise.all([applications.get(candidateId, id), applications.statusOf(candidateId, id)]);
        if (!application || !state) return { ok: false, error: "not_found" };
        const { t } = createI18n(language);
        const label = (each: ApplicationStatus) => t(`applicationStatuses.${each}`);
        const what = t("coachProposals.fields.applicationStatus");
        const change: ProposedChange = {
          target: { kind: "application", id, name: [application.jobOffer.title, application.jobOffer.employer].filter(Boolean).join(" · "), href: routes.application(id) },
          what,
          before: label(state.status),
          after: label(status),
          value: { status },
          fields: [{ name: "status", label: what, type: "select", options: APPLICATION_STATUSES.map((each) => ({ value: each, label: label(each) })) }],
          version: state.version,
        };
        return { ok: true, data: change, pages: [routes.application(id)] };
      },
      async apply(change, { candidateId, cardId, at }) {
        const id = change.target.id;
        const before = await applications.statusOf(candidateId, id);
        if (!before) return { ok: false, error: "not_found" };
        if (before.version !== change.version) return { ok: false, error: "conflict" };
        const changed = await applications.change(candidateId, id, { status: change.value.status }, { version: change.version, origin: { origin: "coach_proposal", cardId, appliedAt: at } });
        if (!changed.ok) return refused(changed);
        const after = await applications.statusOf(candidateId, id);
        return { ok: true, undo: { applicationId: id, status: before.status, origin: before.origin, version: after?.version ?? "" } };
      },
      async undo(undo, { candidateId }) {
        const kept = undoSchema.safeParse(undo);
        if (!kept.success) return { ok: false, error: "not_found" };
        const { applicationId, status, origin, version } = kept.data;
        const changed = await applications.change(candidateId, applicationId, { status }, { version, origin: readOrigin(origin) });
        if (changed.ok) return { ok: true };
        return refused(changed).error === "conflict" ? { ok: false, error: "conflict" } : { ok: false, error: "not_found" };
      },
    }),
    defineCoachAction({
      name: E2E_SLOW_READ_ACTION,
      description: "Lit une candidature du candidat par son id, lentement.",
      schema: z.object({ id: z.string().min(1), ms: z.number().int().min(0).max(10_000) }),
      group: "applications",
      kind: "read",
      copiesText: false,
      async run({ id, ms }, { candidateId, signal }) {
        await after(ms, signal);
        const application = await applications.get(candidateId, id);
        if (!application) return { ok: false, error: "not_found" };
        // A Job Offer's title and employer: text the Candidate did not write.
        const name = [application.jobOffer.employer, application.jobOffer.title].filter(Boolean).join(" · ");
        return {
          ok: true,
          data: `Candidature : ${[application.jobOffer.title, application.jobOffer.employer].filter(Boolean).join(" · ")}`,
          pages: [routes.application(id)],
          untrusted: true,
          // What it read, named for the thread's line (#788).
          seen: [{ type: "application", href: routes.application(id), name: name.slice(0, 80) }],
        };
      },
    }),
  ];
}
