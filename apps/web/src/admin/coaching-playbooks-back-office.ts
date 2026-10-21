/**
 * The Coaching Playbooks' Back Office writes (#225), each recorded in the Back Office Audit.
 *
 * `createCoachingPlaybooksBackOffice(playbooks, backOffice)` mirrors the Coaching Playbooks' writes
 * with the Administrator making them: each runs through the Back Office's `record`, so the change and
 * its entry share one transaction. A refused validation is recorded as a failed attempt with its
 * Failure Reason (#263); any other refused write, an unchanged save and an archive that changes
 * nothing record nothing. Every entry targets the Coaching Playbook (or "core-digest", "sources") and
 * names the version it concerns, so the Journal can link to it. A version's rules are recorded by their
 * length only: the version itself, kept forever, holds them.
 */
import type {
  ArchivePlaybookResult,
  CoachingPlaybooks,
  CreatePlaybookResult,
  PlaybookVersion,
  SavePlaybookResult,
  ValidatePlaybookResult,
} from "../coaching-playbooks";
import type { FailureReason } from "@jobhub/shared";
import type { BackOffice, BackOfficeActor, BackOfficeAttempt, BackOfficeChange, Recorded } from "./back-office";

export interface CoachingPlaybooksBackOffice {
  create(actor: BackOfficeActor, input: unknown): Promise<CreatePlaybookResult>;
  save(actor: BackOfficeActor, id: string, input: unknown): Promise<SavePlaybookResult>;
  /** `actor.name`: the name the validation is given under. */
  validate(actor: BackOfficeActor & { name: string }, id: string, version: number): Promise<ValidatePlaybookResult>;
  setArchived(actor: BackOfficeActor, id: string, archived: boolean): Promise<ArchivePlaybookResult>;
}

/** A Playbook Version as recorded: its number, its Playbook Agent, and its rules' length. */
const recordedVersion = (version: PlaybookVersion): { [key: string]: Recorded } => ({
  version: version.version,
  ...(version.agent ? { provider: version.agent.provider, model: version.agent.model, effort: version.agent.effort, consultWhen: version.agent.consultWhen } : {}),
  rulesCharacters: version.content.length,
});

const SECTION = "coaching_playbooks";

/** A validation refused by a business rule, by its Failure Reason; an unknown version is not one. */
const VALIDATION_REFUSALS: Record<Exclude<Extract<ValidatePlaybookResult, { ok: false }>["error"], "not_found">, FailureReason> = {
  not_latest: "not_latest_version",
  already_validated: "already_validated",
  own_version: "own_version",
  no_eval_run: "no_eval_run",
};

export function createCoachingPlaybooksBackOffice(playbooks: CoachingPlaybooks, backOffice: Pick<BackOffice, "record">): CoachingPlaybooksBackOffice {
  return {
    create(actor, input) {
      return backOffice.record(
        actor,
        (within) => playbooks.create(actor, input, within),
        (created): BackOfficeChange | null =>
          created.ok ? { section: SECTION, target: created.version.playbookId, action: "added", before: null, after: recordedVersion(created.version) } : null,
      );
    },

    save(actor, id, input) {
      return backOffice.record(
        actor,
        (within) => playbooks.save(actor, id, input, within),
        (saved): BackOfficeChange | null =>
          saved.ok ? { section: SECTION, target: id, action: "updated", before: recordedVersion(saved.before), after: recordedVersion(saved.version) } : null,
      );
    },

    validate(actor, id, version) {
      return backOffice.record(
        actor,
        (within) => playbooks.validate(actor, id, version, within),
        (validated): BackOfficeAttempt | null =>
          !validated.ok
            ? validated.error === "not_found"
              ? null
              : { section: SECTION, target: id, tried: "validated", reason: VALIDATION_REFUSALS[validated.error], field: "version" }
            : {
                section: SECTION,
                target: id,
                action: "validated",
                before: { version, validatedBy: null },
                after: { version, validatedBy: validated.version.validation!.name, validatedAt: validated.version.validation!.at.toISOString() },
              },
      );
    },

    setArchived(actor, id, archived) {
      return backOffice.record(
        actor,
        (within) => playbooks.setArchived(id, archived, within),
        (done): BackOfficeChange | null =>
          done.ok && done.changed
            ? {
                section: SECTION,
                target: id,
                action: archived ? "archived" : "restored",
                before: { version: done.version, archived: !archived },
                after: { version: done.version, archived },
              }
            : null,
      );
    },
  };
}
