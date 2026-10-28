/**
 * The Recognised senders' Back Office writes (#448), each recorded in the Back Office Audit.
 *
 * `createRecognisedSendersBackOffice(senders, backOffice)` mirrors the platform's Recognised sender list's writes with
 * the Administrator making them: each runs through the Back Office's `record`, so the change and its entry share one
 * transaction. A refused write (invalid, already listed, unknown) records nothing. Entries are targeted by the
 * sender's domain or address and hold its label and whether it is enabled: no Candidate, no email.
 */
import type { AddRecognisedSenderResult, ListedRecognisedSender, RecognisedSenderList } from "../email-intake/recognised-sender-list";
import type { BackOffice, BackOfficeActor } from "./back-office";

export interface RecognisedSendersBackOffice {
  /** Adds a sender, or accepts a proposed one, with its label. */
  add(actor: BackOfficeActor, input: unknown): Promise<AddRecognisedSenderResult>;
  /** Changes its label or whether it is enabled. */
  update(actor: BackOfficeActor, value: string, changes: unknown): Promise<{ ok: true } | { ok: false; error: "invalid" | "not_found" }>;
  remove(actor: BackOfficeActor, value: string): Promise<boolean>;
}

const recorded = (sender: Pick<ListedRecognisedSender, "label" | "enabled">) => ({ label: sender.label, enabled: sender.enabled });

export function createRecognisedSendersBackOffice(senders: RecognisedSenderList, backOffice: Pick<BackOffice, "record">): RecognisedSendersBackOffice {
  return {
    add(actor, input) {
      return backOffice.record(
        actor,
        (within) => senders.add(input, within),
        (added) => (added.ok ? { section: "recognised_senders", target: added.sender.value, action: "added", before: null, after: recorded(added.sender) } : null),
      );
    },

    async update(actor, value, changes) {
      const updated = await backOffice.record(
        actor,
        (within) => senders.update(value, changes, within),
        (done) => (done.ok ? { section: "recognised_senders", target: done.before.value, action: "updated", before: recorded(done.before), after: recorded(done.after) } : null),
      );
      return updated.ok ? { ok: true } : updated;
    },

    async remove(actor, value) {
      const removed = await backOffice.record(
        actor,
        (within) => senders.remove(value, within),
        (sender) => (sender ? { section: "recognised_senders", target: sender.value, action: "removed", before: recorded(sender), after: null } : null),
      );
      return removed !== null;
    },
  };
}
