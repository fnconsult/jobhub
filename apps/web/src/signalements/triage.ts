/**
 * Signalement triage's view of the Signalements (#1139, ADR-0118): what an Agent Key of scope `signalements` reads and
 * changes through `/admin/api/signalements`, and nothing more.
 *
 * `createSignalementTriage({ signalements, identityOf, environment })` answers:
 *  - `queue` and `one`: only the Signalements sent with the AI notice, each with exactly TRIAGE_KEYS (type, message,
 *    date, status, environment, Version, browser or device, Interface Language, Text Size, the page's path with each id
 *    as `:id`, a Question's copy of the question and the coach's reply). Every text goes through Redaction first, the
 *    Preferred Name included: the Candidate's name, email, phone and address come out as « [NOM] », « [E-MAIL] »…
 *    Never the Candidate's email, name, Plan or id, the team's reply, nor any object of theirs;
 *  - `markSeen`: « vu », and only « vu », signed `key:<name>` (statutMajPar), which the Back Office shows as
 *    « vu par triage-beta ». One already « vu » is left as it is; one « traité » is refused.
 */
import { redactIdentity, type CandidateIdentity } from "@jobhub/ai";
import { agentSignature } from "../agent-keys/values";
import { routePattern } from "../route-pattern";
import type { Signalement, Signalements, SignalementStatus, TriageableSignalement } from "./index";

/** The keys of every Signalement triage reads, in this order: the only ones, tested with `Object.keys`. */
export const TRIAGE_KEYS = [
  "id",
  "type",
  "message",
  "sentAt",
  "status",
  "environment",
  "version",
  "device",
  "interfaceLanguage",
  "textSize",
  "path",
  "attachedQuestion",
  "attachedCoachReply",
] as const;

export interface TriageSignalement {
  id: string;
  type: Signalement["type"];
  /** Redacted. */
  message: string;
  /** ISO: when the Candidate sent it. */
  sentAt: string;
  status: SignalementStatus;
  /** Where this server runs (JOBHUB_TARGET: `staging` for the Beta, `production`): every Signalement it holds was sent there. */
  environment: string;
  /** The Jobbbox version that served it. */
  version: string;
  /** « Chrome 141, Mac », or « App Jobbbox 1.4.0, iOS 18.6 »; null when it was not known. */
  device: string | null;
  interfaceLanguage: Signalement["context"]["interfaceLanguage"];
  textSize: Signalement["context"]["textSize"];
  /** The page's route pattern, each id as `:id` (`/candidatures/:id/documents`); null when it was not known. */
  path: string | null;
  /** A Question's copy of the Candidate's question and the coach's reply, redacted; null for a Bug or an Idée. */
  attachedQuestion: string | null;
  attachedCoachReply: string | null;
}

export type MarkSeenResult = { ok: true; signalement: TriageSignalement } | { ok: false; error: "not_found" | "already_handled" };

export interface SignalementTriage {
  /** The queue, oldest first, of `statuses` (default: every one). */
  queue(filter?: { statuses?: readonly SignalementStatus[] }): Promise<TriageSignalement[]>;
  /** One; null for one not sent with the AI notice, or none. */
  one(id: string): Promise<TriageSignalement | null>;
  /** Marks it « vu », signed by the Agent Key `keyName`. */
  markSeen(id: string, keyName: string): Promise<MarkSeenResult>;
}

export interface SignalementTriageDeps {
  signalements: Pick<Signalements, "triageable" | "triageableOne" | "changeStatus">;
  /** The Candidate's identity, taken out of every text (candidate-identity). A lookup that fails fails the call: nothing goes out unredacted. */
  identityOf: (candidateId: string) => Promise<CandidateIdentity | null>;
  /** Where this server runs (Release.environment). */
  environment: string;
}

/**
 * `identity` with its Preferred Name taken out like a first name. Redaction leaves a Preferred Name in the text, and
 * clearing it only ends that exemption: one that is neither the first nor the last name would still go through.
 */
function withPreferredNameTakenOut(identity: CandidateIdentity): CandidateIdentity {
  const givenNames = typeof identity.givenName === "string" ? [identity.givenName] : [...(identity.givenName ?? [])];
  return { ...identity, givenName: identity.preferredName ? [...givenNames, identity.preferredName] : givenNames, preferredName: null };
}

export function createSignalementTriage({ signalements, identityOf, environment }: SignalementTriageDeps): SignalementTriage {
  /** Its fixed keys, each text redacted with its Candidate's identity, their Preferred Name taken out too. */
  async function shown({ candidateId, signalement }: TriageableSignalement): Promise<TriageSignalement> {
    const identity = await identityOf(candidateId);
    const texts = [signalement.message, signalement.attachedQuestion ?? "", signalement.attachedCoachReply ?? ""];
    const [message, attachedQuestion, attachedCoachReply] = redactIdentity(texts, identity && withPreferredNameTakenOut(identity)).texts;
    return {
      id: signalement.id,
      type: signalement.type,
      message: message!,
      sentAt: signalement.createdAt.toISOString(),
      status: signalement.status,
      environment,
      version: signalement.context.version,
      device: signalement.context.browser,
      interfaceLanguage: signalement.context.interfaceLanguage,
      textSize: signalement.context.textSize,
      path: routePattern(signalement.context.path, ":id"),
      attachedQuestion: signalement.attachedQuestion === null ? null : attachedQuestion!,
      attachedCoachReply: signalement.attachedCoachReply === null ? null : attachedCoachReply!,
    };
  }

  return {
    async queue(filter) {
      return Promise.all((await signalements.triageable(filter)).map(shown));
    },

    async one(id) {
      const found = await signalements.triageableOne(id);
      return found ? shown(found) : null;
    },

    async markSeen(id, keyName) {
      const found = await signalements.triageableOne(id);
      if (!found) return { ok: false, error: "not_found" };
      if (found.signalement.status === "traite") return { ok: false, error: "already_handled" };
      if (found.signalement.status === "vu") return { ok: true, signalement: await shown(found) };
      const changed = await signalements.changeStatus(id, "vu", undefined, agentSignature(keyName));
      if (!changed || "refused" in changed) return { ok: false, error: "not_found" };
      return { ok: true, signalement: await shown({ candidateId: found.candidateId, signalement: changed.after }) };
    },
  };
}
