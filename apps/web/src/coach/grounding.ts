/**
 * What grounds the AI Coach's reply in Jobbbox's coaching knowledge (retrieval, not fine-tuning):
 * always the Core Digest, plus 1 or 2 Coaching Playbooks picked from what is In view and the
 * topic of the Candidate's message, within KNOWLEDGE_MAX_TOKENS.
 *
 *   const { text, used } = grounding(knowledge, { inView: focus?.kind, message });
 *
 * `text` goes into the system prompt; `used` names the Core Digest and the playbooks it holds,
 * with their versions, to be recorded with the reply. Only what `knowledge` serves can be used:
 * in production, only Human-validated knowledge (ADR-0019).
 *
 * Topic detection is keyword rules on the latest Candidate message (accents and case ignored),
 * in French and in English: the Coach answers in the Candidate's language, so each row lists both.
 * Playbooks the message topic calls for come first, each matched topic giving its first
 * playbook before any gives its second; then those for what is In view; with neither, the
 * 40+ positioning playbook, which concerns every Candidate.
 */
import type { CoachKnowledge, KnowledgeDocument, PlaybookId } from "@jobhub/coach-knowledge";
import { estimateTokens, type CoachFocus } from "./context";

/** A Coaching Playbook or the Core Digest ("core-digest") a reply drew on, at the version it had. */
export interface PlaybookUsed {
  id: PlaybookId | "core-digest";
  version: string;
}

/** Most playbooks in one reply. */
export const MAX_PLAYBOOKS = 2;

/** Room for the coaching knowledge (Core Digest, playbooks and their Sources) in the context, in estimated tokens. */
export const KNOWLEDGE_MAX_TOKENS = 6_000;

/** The playbook table: what is In view, or what the message is about → the playbooks to add. */
interface PlaybookRow {
  playbooks: PlaybookId[];
  inView: CoachFocus["kind"][];
  /** Matched against the message in lower case, without accents. French rules, then English ones. */
  topic: RegExp[];
}

const APPLICATION: PlaybookRow = {
  playbooks: ["cover-letter-writing", "ats-optimization"],
  inView: ["application"],
  topic: [
    /\blettres?\b/,
    /\bats\b/,
    /\bmots?[- ]cles?\b/,
    /\bletters?\b/,
    /\bkeywords?\b/,
    /\bapplicant tracking\b/,
  ],
};
const JOB_OFFER: PlaybookRow = {
  playbooks: ["cv-offer-fit-scoring"],
  // A Job Search and a Job Digest list Job Offers with their Match Scores.
  inView: ["job_offer", "job_search", "job_digest"],
  topic: [
    /\boffres?\b/,
    /\bannonces?\b/,
    /\bfiches? de poste\b/,
    /\bscores?\b/,
    /\bcorrespond/,
    /\badequation\b/,
    /\boffers?\b/,
    /\bpostings?\b/,
    /\bjob (?:ads?|adverts?|descriptions?)\b/,
    /\bmatch(?:es|ing)?\b/,
  ],
};
const INTERVIEW: PlaybookRow = {
  playbooks: ["interview-journey-stages", "interview-psychology"],
  inView: [],
  topic: [
    /\bentretiens?\b/,
    /\binterviews?\b/,
    /\bn ?\+ ?[12]\b/,
    /\bpretentions? salariales?\b/,
    /\bsalary (?:expectations?|negotiations?|requirements?)\b/,
    /\bhiring managers?\b/,
  ],
};
const OUTREACH: PlaybookRow = {
  playbooks: ["outreach-first-contact", "application-strategy"],
  inView: [],
  topic: [
    /\breseau/,
    /\bnetwork/,
    /\bcontacter\b/,
    /\b(?:prise|premier) de contact\b/,
    /\blinkedin\b/,
    /\bcooptation\b/,
    /\bapproche directe\b/,
    /\bmarche cache\b/,
    /\bcandidatures? spontanees?\b/,
    /\bchasseurs? de tetes?\b/,
    /\bcabinets? de recrutement\b/,
    /\breach(?:ing)? out\b/,
    /\breferrals?\b/,
    /\bcold (?:emails?|messages?|calls?|approach)\b/,
    /\bhidden job market\b/,
    /\b(?:unsolicited|speculative) applications?\b/,
    /\bhead ?hunters?\b/,
    /\brecruit(?:ment|ing) (?:agenc|firms?\b)/,
  ],
};
const FREELANCE: PlaybookRow = {
  playbooks: ["freelance-mission-positioning"],
  inView: [],
  topic: [
    /\bfree[- ]?lance/,
    /\bportage\b/,
    /\binterim/,
    /\b(?:management|manager) de transition\b/,
    /\bindependante?s?\b/,
    /\b(?:auto|micro)[- ]?entrepr/,
    /\btjm\b/,
    /\bindependent\b/,
    /\bself[- ]employ/,
    /\bcontractors?\b/,
    /\bumbrella compan/,
    /\bdaily rates?\b/,
  ],
};
const POSITIONING: PlaybookRow = {
  playbooks: ["senior-40plus-positioning"],
  // The Profile is the Candidate's positioning: its target role and Master CV.
  inView: ["profile"],
  topic: [
    /\bage\b/,
    /\bagee?s?\b/,
    /\b[4-6]\d ans\b/,
    /\bseniors?\b/,
    /\bpositionn/,
    /\bcv\b/,
    /\bsurqualifie/,
    /\bpitch\b/,
    /\breconversion\b/,
    /\bdiscrimin/,
    /\b[4-6]\d(?: years old|s)\b/,
    /\bolder\b/,
    /\bpositioning\b/,
    // A French « résumé » is a summary: only « my resume », « the resume »… is the CV.
    /\b(?:my|your|the|a) resumes?\b/,
    /\boverqualified\b/,
    /\bcareer (?:change|switch)/,
  ],
};
const PACE: PlaybookRow = {
  playbooks: ["coaching-journey-gamification"],
  inView: [],
  topic: [
    /\brythme\b/,
    // Not a cover letter: « lettre de motivation », "motivation letter".
    /(?<!lettres? de )\bmotivation\b(?! letters?\b)/,
    /\b(?:de)?motive/,
    /\bdecourag/,
    /\bmoral\b/,
    /\bfatigu/,
    /\bepuise/,
    /\bbudget\b/,
    /\bargent\b/,
    /\bindemni/,
    /\bchomage\b/,
    /\bcombien de temps\b/,
    /\bplan d'action\b/,
    /\bpace\b/,
    /\b(?:de|un)?motivated\b/,
    /\bdiscourag/,
    /\bmorale\b/,
    /\bexhaust/,
    /\btired\b/,
    /\bburn(?:ed|t)? ?out\b/,
    /\bmoney\b/,
    /\bunemploy/,
    /\bseverance\b/,
    /\bhow long\b/,
    /\baction plan\b/,
  ],
};

/** In the issue's order (#129): the order in which matched topics give their playbooks. */
const PLAYBOOK_TABLE: PlaybookRow[] = [APPLICATION, JOB_OFFER, INTERVIEW, OUTREACH, FREELANCE, POSITIONING, PACE];

/** Lower case, without accents and with plain apostrophes, so the topic rules stay simple. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’`]/g, "'")
    .toLowerCase();
}

/** The playbooks this message calls for, most relevant first (longer than MAX_PLAYBOOKS: some may not be served). */
export function selectPlaybooks({ inView, message }: { inView?: CoachFocus["kind"]; message: string }): PlaybookId[] {
  const text = normalize(message);
  const topics = PLAYBOOK_TABLE.filter((row) => row.topic.some((rule) => rule.test(text)));
  const ranked = Array.from({ length: Math.max(0, ...topics.map((row) => row.playbooks.length)) }, (_, rank) =>
    topics.flatMap((row) => row.playbooks[rank] ?? []),
  ).flat();
  const forInView = PLAYBOOK_TABLE.filter((row) => inView && row.inView.includes(inView)).flatMap((row) => row.playbooks);
  const picked = [...new Set([...ranked, ...forInView])];
  return picked.length > 0 ? picked : POSITIONING.playbooks;
}

/** A knowledge document as the AI Coach reads it, tagged with what it is and its version. */
function documentText(tag: string, attributes: string, document: KnowledgeDocument): string {
  return `<${tag} ${attributes}version="${document.version}">\n${document.text}\n</${tag}>`;
}

/** The Sources the documents cite, so the AI Coach can name them in plain words. */
function sourcesText(documents: KnowledgeDocument[]): string {
  const sources = new Map(documents.flatMap((document) => document.sources).map((source) => [source.id, source]));
  if (sources.size === 0) return "";
  const lines = [...sources.values()]
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    .map((source) => `[${source.id}] ${source.author}, ${source.year} : ${source.title}`);
  return ["<sources>", ...lines, "</sources>"].join("\n");
}

/**
 * The Core Digest and the first MAX_PLAYBOOKS of `preferred` that `knowledge` serves and that fit,
 * with the Sources they cite, within `maxTokens`; and what was used. Empty when nothing is served.
 */
export function grounding(
  knowledge: Pick<CoachKnowledge, "playbook" | "coreDigest">,
  selection: { inView?: CoachFocus["kind"]; message: string },
  maxTokens = KNOWLEDGE_MAX_TOKENS,
): { text: string; used: PlaybookUsed[] } {
  const digest = knowledge.coreDigest();
  const parts: { text: string; document: KnowledgeDocument; used: PlaybookUsed }[] = digest
    ? [{ text: documentText("socle", "", digest), document: digest, used: { id: "core-digest", version: digest.version } }]
    : [];
  const render = (chosen: typeof parts) => [...chosen.map((part) => part.text), sourcesText(chosen.map((part) => part.document))].filter(Boolean).join("\n\n");

  let added = 0;
  for (const id of selectPlaybooks(selection)) {
    if (added === MAX_PLAYBOOKS) break;
    const playbook = knowledge.playbook(id);
    if (!playbook) continue;
    const part = { text: documentText("playbook", `id="${id}" `, playbook), document: playbook, used: { id, version: playbook.version } };
    if (estimateTokens(render([...parts, part])) > maxTokens) continue;
    parts.push(part);
    added += 1;
  }
  return { text: render(parts), used: parts.map((part) => part.used) };
}
