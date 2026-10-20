/**
 * The Guardrails' Back Office writes (#228), each recorded in the Back Office Audit.
 *
 * `createGuardrailsBackOffice(store, backOffice)` mirrors the Guardrail store's writes with the
 * Administrator making them: each runs through the Back Office's `record`, so the change and its entry
 * share one transaction. A refused write and an unchanged setting record nothing. Every entry targets the
 * Guardrail by its id; a Guardrail message's entry names its language and version, and its text, which is
 * Jobbbox's own wording, never personal data.
 */
import type { GuardrailMessageVersion, GuardrailStore, SaveMessageResult, SetSettingResult, ValidateMessageResult } from "../guardrails/store";
import type { BackOffice, BackOfficeActor, BackOfficeChange } from "./back-office";

export interface GuardrailsBackOffice {
  setSetting(actor: BackOfficeActor, id: string, setting: unknown): Promise<SetSettingResult>;
  saveMessage(actor: BackOfficeActor, id: string, language: string, text: unknown): Promise<SaveMessageResult>;
  /** `actor.name`: the name the validation is given under. */
  validateMessage(actor: BackOfficeActor & { name: string }, id: string, language: string, version: number): Promise<ValidateMessageResult>;
}

const SECTION = "guardrails";

const recordedMessage = (message: GuardrailMessageVersion) => ({ language: message.language, version: message.version, text: message.text });

export function createGuardrailsBackOffice(store: Pick<GuardrailStore, "setSetting" | "saveMessage" | "validateMessage">, backOffice: Pick<BackOffice, "record">): GuardrailsBackOffice {
  return {
    setSetting(actor, id, setting) {
      return backOffice.record(
        actor,
        (within) => store.setSetting(id, setting, within),
        (done): BackOfficeChange | null => (done.ok && done.changed ? { section: SECTION, target: id, action: "updated", before: { setting: done.before }, after: { setting: done.after } } : null),
      );
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
