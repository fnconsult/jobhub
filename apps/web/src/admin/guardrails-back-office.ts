/**
 * The Guardrails' Back Office writes (#228), each recorded in the Back Office Audit.
 *
 * `createGuardrailsBackOffice(store, backOffice)` mirrors the Guardrail store's writes with the
 * Administrator making them: each runs through the Back Office's `record`, so the change and its entry
 * share one transaction. A refused write and an unchanged setting record nothing. Every entry targets the
 * Guardrail by its id; a Guardrail message's entry names its language and version, and its text, which is
 * Jobbbox's own wording, never personal data.
 *
 * A new Guardrail setting is saved only after the Guardrails' Eval Cases have been played on it, the other
 * settings as they are (ADR-0023, #231): it is refused, and nothing recorded, when it lets through a case the
 * distress, personal data leak or secret disclosure Guardrail must block. An unchanged or unusable setting, and a
 * Guardrail message, play no Eval Case.
 */
import type { EvalRun, Evals, GuardrailsRun } from "../evals";
import { ALWAYS_ON_GUARDRAILS, GUARDRAIL_SETTINGS, isGuardrailId, type GuardrailSetting } from "../guardrails";
import type { GuardrailMessageVersion, GuardrailStore, SaveMessageResult, SetSettingResult, ValidateMessageResult } from "../guardrails/store";
import type { BackOffice, BackOfficeActor, BackOfficeChange } from "./back-office";

/** `run`: the Eval Run played on a new setting. `eval_refused`: it let through `refused`, the setting is not saved. */
export type SetGuardrailSettingResult =
  | (SetSettingResult & { run?: EvalRun })
  | { ok: false; error: "eval_refused"; run: EvalRun; refused: GuardrailsRun["refused"] };

export interface GuardrailsBackOffice {
  setSetting(actor: BackOfficeActor, id: string, setting: unknown): Promise<SetGuardrailSettingResult>;
  saveMessage(actor: BackOfficeActor, id: string, language: string, text: unknown): Promise<SaveMessageResult>;
  /** `actor.name`: the name the validation is given under. */
  validateMessage(actor: BackOfficeActor & { name: string }, id: string, language: string, version: number): Promise<ValidateMessageResult>;
}

const SECTION = "guardrails";

const recordedMessage = (message: GuardrailMessageVersion) => ({ language: message.language, version: message.version, text: message.text });

export function createGuardrailsBackOffice(
  store: Pick<GuardrailStore, "config" | "setSetting" | "saveMessage" | "validateMessage">,
  backOffice: Pick<BackOffice, "record">,
  evals: Pick<Evals, "runGuardrails">,
): GuardrailsBackOffice {
  const record = (actor: BackOfficeActor, id: string, setting: unknown) =>
    backOffice.record(
      actor,
      (within) => store.setSetting(id, setting, within),
      (done): BackOfficeChange | null => (done.ok && done.changed ? { section: SECTION, target: id, action: "updated", before: { setting: done.before }, after: { setting: done.after } } : null),
    );

  return {
    async setSetting(actor, id, setting) {
      const { settings } = await store.config.current();
      const changes = isGuardrailId(id) && !ALWAYS_ON_GUARDRAILS.includes(id) && GUARDRAIL_SETTINGS.includes(setting as GuardrailSetting) && settings[id] !== setting;
      // Unchanged or unusable: the store says which, and nothing is played.
      if (!changes) return record(actor, id, setting);
      const { run, refused } = await evals.runGuardrails(actor, { ...settings, [id]: setting as GuardrailSetting });
      if (refused.length > 0) return { ok: false, error: "eval_refused", run, refused };
      return { ...(await record(actor, id, setting)), run };
    },

    saveMessage(actor, id, language, text) {
      return backOffice.record(
        actor,
        (within) => store.saveMessage(actor, id, language, text, within),
        (saved): BackOfficeChange | null =>
          saved.ok
            ? { section: SECTION, target: id, action: saved.before ? "updated" : "added", before: saved.before ? recordedMessage(saved.before) : null, after: recordedMessage(saved.version) }
            : null,
      );
    },

    validateMessage(actor, id, language, version) {
      return backOffice.record(
        actor,
        (within) => store.validateMessage(actor, id, language, version, within),
        (validated): BackOfficeChange | null =>
          validated.ok
            ? {
                section: SECTION,
                target: id,
                action: "validated",
                before: { language, version, validatedBy: null },
                after: { language, version, validatedBy: validated.version.validation!.name, validatedAt: validated.version.validation!.at.toISOString() },
              }
            : null,
      );
    },
  };
}
