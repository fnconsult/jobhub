/**
 * « Signalements » in the Back Office (#376): the team reads the Candidates' Signalements, changes their status and
 * replies, each change recorded in the Back Office Audit.
 *
 * `createSignalementsBackOffice(signalements, backOffice)` answers, for what an Administrator's `access` allows:
 *  - `list` and `open`: those who change Signalements (Support, super-admins) read every one, with the Candidate's
 *    email and Plan; those who only read them (Help editors) read the Questions alone, without who sent them.
 *    « À traiter » (`nouveau` and `vu`) by default, oldest first. Reading one changes nothing;
 *  - `changeStatus`: any status, in any direction; a Question is marked `traite` only once replied to, else refused
 *    and recorded as a refused attempt (`reply_required`);
 *  - `reply`: one per Signalement, written or changed until it is `traite` (then refused and recorded,
 *    `already_handled`). The Candidate sees it signed « L'équipe Jobbbox », never with the Administrator's name.
 *
 *  - `saveDraft`, `removeDraft` and `sendDraft`, the draft reply Signalement triage proposed (#1141): Support edits it or
 *    deletes it (neither recorded), or sends it: the version in the Candidate's Interface Language becomes the reply,
 *    signed « L'équipe Jobbbox », and « traité » goes with it in one Signalement notification; recorded as the status
 *    before and after and the reply `sent_draft`, never its words.
 *
 * Each entry names the Signalement by its id, with its status before and after, or whether its reply was written or
 * changed: never the message's or the reply's words, which the Back Office Audit (3 years) would outlive. A status
 * unchanged, a reply unchanged, an unknown Signalement or status record nothing; a reply left empty or too long is only
 * shown on the page. Nobody deletes a Signalement from the Back Office.
 */
import type { FieldError } from "../validation";
import {
  type SaveDraftResult,
  SIGNALEMENT_TYPES,
  TO_HANDLE_STATUSES,
  type SentSignalement,
  type Signalement,
  type Signalements,
  type SignalementStatus,
  type SignalementType,
} from "../signalements";
import type { BackOfficeAccess } from "./access";
import type { BackOffice, BackOfficeActor, BackOfficeAttempt } from "./back-office";

/** A Signalement as one Administrator may read it: `candidate` is null for those who only read Signalements. */
export type BackOfficeSignalement = Omit<SentSignalement, "candidate"> & { candidate: SentSignalement["candidate"] | null };

/** Which Signalements to list: one type or all; some statuses, by default « à traiter ». */
export interface BackOfficeSignalementsFilter {
  type?: SignalementType;
  statuses?: readonly SignalementStatus[];
}

export type ChangeStatusResult = { ok: true; signalement: Signalement } | { ok: false; error: "not_found" | "reply_required" };
export type ReplyResult = { ok: true; signalement: Signalement } | { ok: false; error: "not_found" | "already_handled" } | { ok: false; errors: FieldError[] };
export type DraftResult = Extract<SaveDraftResult, { ok: true }> | { ok: false; error: "not_found" | "already_handled" } | { ok: false; errors: FieldError[] };
export type SendDraftResult = { ok: true; signalement: Signalement } | { ok: false; error: "not_found" | "already_handled" | "no_draft" } | { ok: false; errors: FieldError[] };

export interface SignalementsBackOffice {
  list(access: BackOfficeAccess, filter?: BackOfficeSignalementsFilter): Promise<BackOfficeSignalement[]>;
  /** One in full, a Question's attached question and coach reply included; null when there is none `access` may read. */
  open(access: BackOfficeAccess, id: string): Promise<BackOfficeSignalement | null>;
  /** `status` is untrusted (a form's value). */
  changeStatus(actor: BackOfficeActor, id: string, status: unknown): Promise<ChangeStatusResult>;
  /** `text` is untrusted (a form's value): trimmed, at most REPLY_MAX_LENGTH characters. */
  reply(actor: BackOfficeActor, id: string, text: unknown): Promise<ReplyResult>;
  /** Edits the draft reply ({ fr, en }, untrusted), keeping who proposed it. Not recorded. */
  saveDraft(actor: BackOfficeActor, id: string, draft: unknown): Promise<DraftResult>;
  /** Deletes the draft reply. Not recorded. */
  removeDraft(actor: BackOfficeActor, id: string): Promise<{ ok: true } | { ok: false; error: "not_found" }>;
  /** Sends the draft reply, as `edited` ({ fr, en }, untrusted) when given, and marks it « traité » with it; recorded. */
  sendDraft(actor: BackOfficeActor, id: string, edited?: unknown): Promise<SendDraftResult>;
}

const SECTION = "signalements";

/** What `access` may read of the Signalements: every type and who sent them, or the Questions alone. */
function viewOf(access: BackOfficeAccess): { types: readonly SignalementType[]; showsCandidate: boolean } {
  return access.can("signalements", "write") ? { types: SIGNALEMENT_TYPES, showsCandidate: true } : { types: ["question"], showsCandidate: false };
}

const shown = (signalement: SentSignalement, showsCandidate: boolean): BackOfficeSignalement => (showsCandidate ? signalement : { ...signalement, candidate: null });

export function createSignalementsBackOffice(
  signalements: Pick<Signalements, "list" | "one" | "changeStatus" | "reply" | "saveDraft" | "removeDraft" | "sendDraft">,
  backOffice: Pick<BackOffice, "record">,
): SignalementsBackOffice {
  return {
    async list(access, { type, statuses = TO_HANDLE_STATUSES } = {}) {
      if (!access.can("signalements", "read")) return [];
      const view = viewOf(access);
      const types = type === undefined ? view.types : view.types.filter((each) => each === type);
      if (types.length === 0) return [];
      return (await signalements.list({ types, statuses })).map((each) => shown(each, view.showsCandidate));
    },

    async open(access, id) {
      if (!access.can("signalements", "read")) return null;
      const view = viewOf(access);
      const signalement = await signalements.one(id);
      return signalement && view.types.includes(signalement.type) ? shown(signalement, view.showsCandidate) : null;
    },

    async changeStatus(actor, id, status) {
      const done = await backOffice.record(
        actor,
        (within) => signalements.changeStatus(id, status as SignalementStatus, within),
        (result): BackOfficeAttempt | null => {
          if (result === null) return null;
          if ("refused" in result) return { section: SECTION, target: id, tried: "updated", field: "status", reason: "reply_required" };
          if (result.before.status === result.after.status) return null;
          return { section: SECTION, target: id, action: "updated", before: { status: result.before.status }, after: { status: result.after.status } };
        },
      );
      if (done === null) return { ok: false, error: "not_found" };
      if ("refused" in done) return { ok: false, error: done.refused };
      return { ok: true, signalement: done.after };
    },

    async reply(actor, id, text) {
      const done = await backOffice.record(
        actor,
        (within) => signalements.reply(id, text, within),
        (result): BackOfficeAttempt | null => {
          if (result === null || "errors" in result) return null;
          if ("refused" in result) return { section: SECTION, target: id, tried: "updated", field: "reply", reason: "already_handled" };
          if (result.before.reply === result.after.reply) return null;
          return { section: SECTION, target: id, action: "updated", before: { reply: result.before.reply === null ? "none" : "written" }, after: { reply: result.before.reply === null ? "written" : "changed" } };
        },
      );
      if (done === null) return { ok: false, error: "not_found" };
      if ("errors" in done) return { ok: false, errors: done.errors };
      if ("refused" in done) return { ok: false, error: done.refused };
      return { ok: true, signalement: done.after };
    },

    async saveDraft(_actor, id, draft) {
      const saved = await signalements.saveDraft(id, draft);
      if (!saved) return { ok: false, error: "not_found" };
      if (saved.ok) return saved;
      return "refused" in saved ? { ok: false, error: saved.refused } : { ok: false, errors: saved.errors };
    },

    async removeDraft(_actor, id) {
      return (await signalements.removeDraft(id)) ? { ok: true } : { ok: false, error: "not_found" };
    },

    async sendDraft(actor, id, edited) {
      type Sent = Awaited<ReturnType<Signalements["sendDraft"]>> | { errors: FieldError[] };
      const done = await backOffice.record(
        actor,
        async (within): Promise<Sent> => {
          if (edited !== undefined) {
            const saved = await signalements.saveDraft(id, edited, { within });
            if (!saved) return null;
            if (!saved.ok && "errors" in saved) return { errors: saved.errors };
          }
          return signalements.sendDraft(id, within);
        },
        (result): BackOfficeAttempt | null => {
          if (result === null || "errors" in result) return null;
          if ("refused" in result) return result.refused === "already_handled" ? { section: SECTION, target: id, tried: "updated", field: "reply", reason: "already_handled" } : null;
          return {
            section: SECTION,
            target: id,
            action: "updated",
            before: { status: result.before.status, reply: result.before.reply === null ? "none" : "written" },
            after: { status: result.after.status, reply: "sent_draft" },
          };
        },
      );
      if (done === null) return { ok: false, error: "not_found" };
      if ("errors" in done) return { ok: false, errors: done.errors };
      if ("refused" in done) return { ok: false, error: done.refused };
      return { ok: true, signalement: done.after };
    },
  };
}
