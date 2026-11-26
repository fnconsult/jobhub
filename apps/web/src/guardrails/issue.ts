/**
 * The fixed rules of the « Données du Candidate dans une issue » Guardrail (`candidate_data_in_issue`, ADR-0118), always
 * on: what Jobbbox checks before it publishes, on its public GitHub repository, the issue or comment Signalement triage
 * proposes. No setting, no environment variable and no option reaches it: `candidateDataInIssue` takes the texts and the
 * Candidate, nothing else, and its Guardrail can only block (ALWAYS_ON_GUARDRAILS).
 *
 * Redaction first, then the Guardrail: each text goes through Redaction with the Candidate's identity, their Preferred
 * Name taken out like a first name (`everyName`). Whatever Redaction had to take out blocks the text:
 *  - `identity`: the Candidate's name (full, first, last or Preferred), postal address or links;
 *  - `email`, `phone`: an email address or a phone number, the Candidate's or anyone's, by its shape;
 * and so does
 *  - `verbatim_quote`: ISSUE_QUOTE_WORDS words in a row of the Candidate's own words (their message, a Question's copy of
 *    their question), as they wrote them or as the agent read them, redacted; case, accents and punctuation aside.
 * The placeholders Redaction leaves (« [PRÉNOM] », « [E-MAIL] ») name no one and go through.
 *
 * Pure: the caller records the Guardrail Trigger (signalements/triage) and plays the Eval Cases (evals).
 */
import { redactIdentity, type CandidateIdentity, type RedactedKind } from "@jobhub/ai";

/** Why an issue's text is blocked, in this order. */
export const ISSUE_BLOCK_REASONS = ["identity", "email", "phone", "verbatim_quote"] as const;
export type IssueBlockReason = (typeof ISSUE_BLOCK_REASONS)[number];

/** How many words in a row of the Candidate's own make a quote. */
export const ISSUE_QUOTE_WORDS = 6;

/** What the Guardrail knows of the Candidate: their identity (null when unknown) and their own words. */
export interface IssueCandidate {
  identity: CandidateIdentity | null;
  /** The texts the Candidate wrote, as written or redacted: the Signalement's message, a Question's copy of their question. */
  words: readonly string[];
}

export type IssueCheck<F extends Record<string, string>> = { ok: true; fields: F } | { ok: false; reasons: IssueBlockReason[]; fields: (keyof F & string)[] };

const REASON_OF: Record<RedactedKind, IssueBlockReason> = { name: "identity", address: "identity", link: "identity", email: "email", phone: "phone" };

/**
 * `identity` with its Preferred Name taken out like a first name. Redaction leaves a Preferred Name in the text, and
 * clearing it only ends that exemption: one that is neither the first nor the last name would still go through.
 */
export function everyName(identity: CandidateIdentity): CandidateIdentity {
  const givenNames = typeof identity.givenName === "string" ? [identity.givenName] : [...(identity.givenName ?? [])];
  return { ...identity, givenName: identity.preferredName ? [...givenNames, identity.preferredName] : givenNames, preferredName: null };
}

/** A text's words, in lower case, without accents: a placeholder (« [NOM] ») and punctuation split them. */
function wordsOf(text: string): string[][] {
  return text
    .split(/\[[^\]]*\]/)
    .map((part) =>
      part
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    )
    .filter((run) => run.length > 0);
}

/** Every run of ISSUE_QUOTE_WORDS words of `texts`, joined by a space. */
function quotesOf(texts: readonly string[]): Set<string> {
  const quotes = new Set<string>();
  for (const run of texts.flatMap(wordsOf)) for (let at = 0; at + ISSUE_QUOTE_WORDS <= run.length; at++) quotes.add(run.slice(at, at + ISSUE_QUOTE_WORDS).join(" "));
  return quotes;
}

const quotes = (text: string, candidateQuotes: Set<string>): boolean => [...quotesOf([text])].some((quote) => candidateQuotes.has(quote));

/**
 * Whether the issue's `fields` may be published: each one as written when nothing is found, else every reason and every
 * field at fault, in order. Always on: it takes nothing that could switch it off.
 */
export function candidateDataInIssue<F extends Record<string, string>>(fields: F, candidate: IssueCandidate): IssueCheck<F> {
  const identity = candidate.identity && everyName(candidate.identity);
  const candidateQuotes = quotesOf(candidate.words);
  const reasons = new Set<IssueBlockReason>();
  const faulty: (keyof F & string)[] = [];
  for (const [field, text] of Object.entries(fields) as [keyof F & string, string][]) {
    const found = new Set<IssueBlockReason>();
    const redaction = redactIdentity([text], identity);
    for (const [kind, count] of Object.entries(redaction.counts) as [RedactedKind, number][]) if (count > 0) found.add(REASON_OF[kind]);
    if (quotes(text, candidateQuotes)) found.add("verbatim_quote");
    if (found.size > 0) faulty.push(field);
    for (const reason of found) reasons.add(reason);
  }
  if (faulty.length === 0) return { ok: true, fields };
  return { ok: false, reasons: ISSUE_BLOCK_REASONS.filter((reason) => reasons.has(reason)), fields: faulty };
}
