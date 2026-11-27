/**
 * Signalement triage's view of the Signalements (#1139, ADR-0118): what an Agent Key of scope `signalements` reads and
 * changes through `/admin/api/signalements`, and nothing more.
 *
 * `createSignalementTriage({ signalements, identityOf, environment })` answers:
 *  - `queue` and `one`: only the Signalements sent with the AI notice, « traité » ones included until their purge, each
 *    with exactly TRIAGE_KEYS (type, message, date, status, environment, Version, browser or device, Interface Language,
 *    Text Size, the page's path with each id as `:id`, a Question's copy of the question and the coach's reply, and
 *    what triage already did, #1173: the issue linked and the draft's signature and date, never its text). Every text
 *    goes through Redaction first, the Preferred Name included: the Candidate's name, email, phone and address come out
 *    as « [NOM] », « [E-MAIL] »… Never the Candidate's email, name, Plan or id, the team's reply, nor any object of theirs;
 *  - `markSeen`: « vu », and only « vu », signed `key:<name>` (statutMajPar), which the Back Office shows as
 *    « vu par triage-beta ». One already « vu » is left as it is; one « traité » is refused. It answers SEEN_KEYS alone;
 *  - for an id it cannot read, each says why (TRIAGE_MISSING_REASONS, #1173), never anything of the Candidate;
 *  - `proposeIssue` (#1141): Jobbbox publishes the issue the agent proposes, never the agent. Its text (title, summary,
 *    steps, expected behaviour, environment, Version, device), or `{ commentOn }` for a duplicate, goes through Redaction
 *    then the « Données du Candidate dans une issue » Guardrail (guardrails/issue), always on: a text blocked comes back
 *    with its reasons, nothing published, the Guardrail Trigger recorded. One that passes is published on GitHub with
 *    ISSUE_LABELS and the Signalement's id in its body (never its text), or commented on the issue named, and linked.
 *    One already linked is refused (`already_linked`, naming its issue): a duplicate goes through `commentOn` on a new
 *    Signalement. One « traité » still takes its issue or comment (#1173), so the link outlives Support's reply;
 *  - `proposeDraft` (#1141): a draft reply in French and in English, kept on the Signalement « proposé par <key> ».
 *    Support sends it, never the agent: the agent never sets « traité ». It answers PROPOSED_DRAFT_KEYS alone, never
 *    the draft's text.
 */
import { redactIdentity, type CandidateIdentity } from "@jobhub/ai";
import { agentSignature } from "../agent-keys/values";
import type { GuardrailTriggerLog } from "../guardrails";
import { candidateDataInIssue, everyName, type IssueBlockReason } from "../guardrails/issue";
import { routePattern } from "../route-pattern";
import type { FieldError } from "../validation";
import { IssuesError, type GitHubIssues, type IssuesErrorReason } from "./github-issues";
import type { Signalement, Signalements, SignalementStatus, TriageableSignalement, TriageMissingReason } from "./index";

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
  "issue",
  "brouillon",
] as const;

/** The keys `markSeen` answers, in this order (#1173): never the message, its context or a draft. */
export const SEEN_KEYS = ["id", "statut", "statutMajPar"] as const;
/** The keys `proposeDraft` answers, in this order (#1173), `brouillon` holding DRAFT_STATE_KEYS: never the draft's text. */
export const PROPOSED_DRAFT_KEYS = ["id", "brouillon"] as const;
export const DRAFT_STATE_KEYS = ["proposePar", "date"] as const;

/** An issue linked to a Signalement, as triage reads it: its number and its page. */
export interface LinkedIssue {
  number: number;
  url: string;
}

/** A draft reply waiting for Support, as triage reads it (#1173): who proposed it and when, never its text. */
export interface DraftState {
  /** The Agent Key that proposed it (`key:triage-beta`); null for one Support wrote. */
  proposePar: string | null;
  /** ISO. */
  date: string;
}

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
  /** The issue linked to it (the first, when there are several); null for none. */
  issue: LinkedIssue | null;
  /** The draft reply waiting for Support; null for none. */
  brouillon: DraftState | null;
}

/** An id triage cannot read, and why (#1173). */
export type NotFound = { ok: false; error: "not_found"; reason: TriageMissingReason };

export type OneResult = { ok: true; signalement: TriageSignalement } | NotFound;

/** What `markSeen` answers: SEEN_KEYS. */
export interface Seen {
  id: string;
  statut: SignalementStatus;
  /** Who set it (`key:triage-beta`); null when the team did. */
  statutMajPar: string | null;
}

export type MarkSeenResult = { ok: true; seen: Seen } | NotFound | { ok: false; error: "already_handled" };

/** The labels of every issue Jobbbox publishes for Signalement triage. */
export const ISSUE_LABELS = ["needs-triage", "signalement"] as const;

/** The fields of an issue the agent proposes, each a text at most this long: required ones first. */
export const ISSUE_FIELDS = { title: 200, summary: 4_000, steps: 4_000, expected: 2_000, environment: 200, version: 200, device: 200 } as const;
type IssueField = keyof typeof ISSUE_FIELDS;
const REQUIRED_ISSUE_FIELDS: readonly IssueField[] = ["title", "summary"];

export type ProposeIssueResult =
  | { ok: true; issue: { number: number; url: string; kind: "opened" | "commented" } }
  | NotFound
  /** One issue per Signalement: the one it already has. */
  | { ok: false; error: "already_linked"; issue: LinkedIssue }
  | { ok: false; error: "invalid"; errors: FieldError[] }
  /** The Guardrail's answer: why, and which fields; nothing was published. */
  | { ok: false; error: "blocked"; guardrail: "candidate_data_in_issue"; reasons: IssueBlockReason[]; fields: string[] }
  | { ok: false; error: "github"; reason: IssuesErrorReason };

/** What `proposeDraft` answers: PROPOSED_DRAFT_KEYS. */
export interface ProposedDraft {
  id: string;
  brouillon: DraftState;
}

export type ProposeDraftResult = { ok: true; proposed: ProposedDraft } | NotFound | { ok: false; error: "already_handled" } | { ok: false; error: "invalid"; errors: FieldError[] };

export interface SignalementTriage {
  /** The queue, oldest first, of `statuses` (default: every one). */
  queue(filter?: { statuses?: readonly SignalementStatus[] }): Promise<TriageSignalement[]>;
  /** One; why not for one not sent with the AI notice, gone, or none. */
  one(id: string): Promise<OneResult>;
  /** Marks it « vu », signed by the Agent Key `keyName`. */
  markSeen(id: string, keyName: string): Promise<MarkSeenResult>;
  /** Publishes the issue, or the comment, the Agent Key `keyName` proposes (`proposal`, untrusted), once checked. */
  proposeIssue(id: string, keyName: string, proposal: unknown): Promise<ProposeIssueResult>;
  /** Keeps the draft reply ({ fr, en }, untrusted) the Agent Key `keyName` proposes. */
  proposeDraft(id: string, keyName: string, draft: unknown): Promise<ProposeDraftResult>;
}

export interface SignalementTriageDeps {
  signalements: Pick<Signalements, "triageable" | "triageableOne" | "whyNotTriageable" | "changeStatus" | "linkIssue" | "saveDraft">;
  /** The Candidate's identity, taken out of every text (candidate-identity). A lookup that fails fails the call: nothing goes out unredacted. */
  identityOf: (candidateId: string) => Promise<CandidateIdentity | null>;
  /** Where this server runs (Release.environment). */
  environment: string;
  /** Where Jobbbox publishes the issue (GITHUB_ISSUES_TOKEN). */
  issues: Pick<GitHubIssues, "open" | "comment">;
  /** The page of the issue `number` on Jobbbox's repository. */
  issueUrl: (number: number) => string;
  /** Where a block of « Données du Candidate dans une issue » is recorded. A log that fails never fails the check. */
  triggers: GuardrailTriggerLog;
  now?: () => Date;
}

/** A trimmed text of at most `max` characters, required or not; what to fix otherwise. */
function field(name: string, value: unknown, max: number, required: boolean): string | null | FieldError {
  if (value !== undefined && value !== null && typeof value !== "string") return { field: name, code: "invalid" };
  const trimmed = (value ?? "").trim();
  if (!trimmed) return required ? { field: name, code: "required" } : null;
  return trimmed.length > max ? { field: name, code: "too_long" } : trimmed;
}

type Proposal = { kind: "issue"; fields: Partial<Record<IssueField, string>> } | { kind: "comment"; on: number; fields: { summary?: string } };

/** The issue, or the comment on a duplicate, the agent proposes; or what to fix. */
function proposalOf(sent: unknown): Proposal | FieldError[] {
  if (!sent || typeof sent !== "object" || Array.isArray(sent)) return [{ field: "body", code: "invalid" }];
  const body = sent as Record<string, unknown>;
  const errors: FieldError[] = [];
  const read = (names: readonly IssueField[], required: readonly IssueField[]) => {
    const fields: Partial<Record<IssueField, string>> = {};
    for (const name of names) {
      const value = field(name, body[name], ISSUE_FIELDS[name], required.includes(name));
      if (typeof value === "string") fields[name] = value;
      else if (value) errors.push(value);
    }
    return fields;
  };
  if (body.commentOn !== undefined) {
    const on = body.commentOn;
    if (typeof on !== "number" || !Number.isInteger(on) || on < 1) errors.push({ field: "commentOn", code: "invalid" });
    const fields = read(["summary"], []);
    return errors.length > 0 ? errors : { kind: "comment", on: on as number, fields };
  }
  const fields = read(Object.keys(ISSUE_FIELDS) as IssueField[], REQUIRED_ISSUE_FIELDS);
  return errors.length > 0 ? errors : { kind: "issue", fields };
}

/** The issue's body, in French like the repository's: the agent's text, the Signalement's id, never its text. */
function issueBody(id: string, fields: Partial<Record<IssueField, string>>): string {
  const environment = [
    fields.environment ? `- Environnement : ${fields.environment}` : null,
    fields.version ? `- Version : ${fields.version}` : null,
    fields.device ? `- Appareil : ${fields.device}` : null,
  ].filter(Boolean);
  return [
    "## Résumé",
    fields.summary ?? "",
    ...(fields.steps ? ["", "## Étapes pour reproduire", fields.steps] : []),
    ...(fields.expected ? ["", "## Comportement attendu", fields.expected] : []),
    ...(environment.length > 0 ? ["", "## Environnement", ...environment] : []),
    "",
    "---",
    `Signalement \`${id}\` : publié par Jobbbox pour le tri des signalements (ADR-0118), après l'anonymisation et le garde-fou « Données du Candidate dans une issue ». Le texte du signalement reste dans le Back Office.`,
  ].join("\n");
}

/** The comment on a duplicate: the new Signalement's id and context, Jobbbox's own data, and the agent's summary if any. */
function commentBody(signalement: Signalement, environment: string, summary: string | undefined): string {
  const context = [signalement.type, environment, `version ${signalement.context.version}`, signalement.context.browser].filter(Boolean).join(", ");
  return [`Un autre signalement décrit ce problème : Signalement \`${signalement.id}\` (${context}).`, ...(summary ? ["", summary] : [])].join("\n");
}

export function createSignalementTriage({ signalements, identityOf, environment, issues, issueUrl, triggers, now = () => new Date() }: SignalementTriageDeps): SignalementTriage {
  const linked = (number: number): LinkedIssue => ({ number, url: issueUrl(number) });
  const draftState = (draft: { proposedBy: string | null; proposedAt: Date }): DraftState => ({ proposePar: draft.proposedBy, date: draft.proposedAt.toISOString() });

  /** Why `id` is not one triage reads. */
  const notFound = async (id: string): Promise<NotFound> => ({ ok: false, error: "not_found", reason: await signalements.whyNotTriageable(id) });

  /** Its fixed keys, each text redacted with its Candidate's identity, their Preferred Name taken out too. */
  async function shown({ candidateId, signalement, issueNumber, draft }: TriageableSignalement): Promise<TriageSignalement> {
    const identity = await identityOf(candidateId);
    const texts = [signalement.message, signalement.attachedQuestion ?? "", signalement.attachedCoachReply ?? ""];
    const [message, attachedQuestion, attachedCoachReply] = redactIdentity(texts, identity && everyName(identity)).texts;
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
      issue: issueNumber === null ? null : linked(issueNumber),
      brouillon: draft === null ? null : draftState(draft),
    };
  }

  return {
    async queue(filter) {
      return Promise.all((await signalements.triageable(filter)).map(shown));
    },

    async one(id) {
      const found = await signalements.triageableOne(id);
      return found ? { ok: true, signalement: await shown(found) } : notFound(id);
    },

    async markSeen(id, keyName) {
      const found = await signalements.triageableOne(id);
      if (!found) return notFound(id);
      if (found.signalement.status === "traite") return { ok: false, error: "already_handled" };
      if (found.signalement.status === "vu") return { ok: true, seen: { id, statut: "vu", statutMajPar: found.statusChangedBy } };
      const by = agentSignature(keyName);
      const changed = await signalements.changeStatus(id, "vu", undefined, by);
      if (!changed || "refused" in changed) return notFound(id);
      return { ok: true, seen: { id, statut: changed.after.status, statutMajPar: by } };
    },

    async proposeIssue(id, keyName, sent) {
      const found = await signalements.triageableOne(id);
      if (!found) return notFound(id);
      if (found.issueNumber !== null) return { ok: false, error: "already_linked", issue: linked(found.issueNumber) };
      const proposal = proposalOf(sent);
      if (Array.isArray(proposal)) return { ok: false, error: "invalid", errors: proposal };

      // Redaction, then the Guardrail, on every word the agent wrote: the Candidate's own words are their message and
      // their question, as written and as the agent read them (redacted).
      const identity = await identityOf(found.candidateId);
      const own = [found.signalement.message, found.signalement.attachedQuestion].filter((text): text is string => text !== null);
      const words = [...own, ...redactIdentity(own, identity && everyName(identity)).texts];
      const checked = candidateDataInIssue(proposal.fields as Record<string, string>, { identity, words });
      if (!checked.ok) {
        try {
          await triggers.record({ guardrail: "candidate_data_in_issue", setting: "block", action: "blocked", agent: "signalement_triage", at: now() });
        } catch (error) {
          console.warn("[signalement-triage] a Guardrail Trigger could not be recorded", error instanceof Error ? error.message : error);
        }
        return { ok: false, error: "blocked", guardrail: "candidate_data_in_issue", reasons: checked.reasons, fields: checked.fields };
      }

      try {
        const published =
          proposal.kind === "issue"
            ? { ...(await issues.open({ title: proposal.fields.title!, body: issueBody(id, proposal.fields), labels: ISSUE_LABELS })), kind: "opened" as const }
            : { ...(await issues.comment(proposal.on, commentBody(found.signalement, environment, proposal.fields.summary))), kind: "commented" as const };
        await signalements.linkIssue(id, { number: published.number, kind: published.kind }, agentSignature(keyName));
        return { ok: true, issue: published };
      } catch (error) {
        if (error instanceof IssuesError) return { ok: false, error: "github", reason: error.reason };
        throw error;
      }
    },

    async proposeDraft(id, keyName, draft) {
      const found = await signalements.triageableOne(id);
      if (!found) return notFound(id);
      const saved = await signalements.saveDraft(id, draft, { by: agentSignature(keyName) });
      if (!saved) return notFound(id);
      if (saved.ok) return { ok: true, proposed: { id, brouillon: draftState(saved.draft) } };
      return "refused" in saved ? { ok: false, error: saved.refused } : { ok: false, error: "invalid", errors: saved.errors };
    },
  };
}
