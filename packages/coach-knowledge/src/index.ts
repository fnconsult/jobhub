/**
 * The AI Coach's coaching knowledge: Jobbbox's playbooks and the sources they cite.
 * Server-side only (reads the Markdown files at load time).
 *
 *   const knowledge = loadCoachKnowledge({ environment: "production" });
 *   knowledge.playbook("ats-optimization")?.rules;
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { citedSourceIds, parsePlaybook, parseSources, type ParsedSource } from "./parse";

export const PLAYBOOK_IDS = [
  "application-strategy",
  "ats-optimization",
  "coaching-journey-gamification",
  "cover-letter-writing",
  "cv-offer-fit-scoring",
  "freelance-mission-positioning",
  "interview-journey-stages",
  "interview-psychology",
  "outreach-first-contact",
  "senior-40plus-positioning",
] as const;
export type PlaybookId = (typeof PLAYBOOK_IDS)[number];

/** A source a playbook cites as `[Sn]`, from `sources.md`. */
export type Source = ParsedSource;

/** One `Rn` rule of a playbook. `sourceIds` are the `[Sn]` it cites. */
export type PlaybookRule = { id: string; title: string; text: string; sourceIds: string[] };

/** What a playbook and the core digest share: a versioned, reviewed set of rules grounded in sources. */
export type KnowledgeDocument = {
  title: string;
  version: string;
  updated: string;
  /** The frontmatter `statut`, verbatim (e.g. "validé (auto-QA Claude, 2026-07-26)"). */
  status: string;
  /** Whether `status` records a human's validation ("validé (<name>, <date>)"), not an AI review. */
  humanValidated: boolean;
  rules: PlaybookRule[];
  /** The frontmatter `sources`, resolved against `sources.md`. */
  sources: Source[];
  /** The whole Markdown without its frontmatter, ready for a prompt. */
  text: string;
};

export type Playbook = KnowledgeDocument & { id: PlaybookId };

/** The ~1k-token cross-cutting rules the AI Coach always follows, whatever the topic. */
export type CoreDigest = KnowledgeDocument;

export type KnowledgeEnvironment = "production" | "development" | "eval";

/**
 * In "production" only what a human validated is served; "development" and "eval" get
 * everything, so unvalidated playbooks can be tried and measured before they ship.
 */
export type CoachKnowledge = {
  /** The playbook, or undefined when it does not exist or is not served in this environment. */
  playbook(id: PlaybookId): Playbook | undefined;
  /** The playbooks served in this environment, by id. */
  playbooks(): Playbook[];
  /** The core digest, or undefined when it is not served in this environment. */
  coreDigest(): CoreDigest | undefined;
};

export type LoadCoachKnowledgeOptions = {
  environment: KnowledgeEnvironment;
  /** The folder holding `playbooks/`, `core-digest.md` and `sources.md`. Defaults to this package's own. */
  dir?: string;
};

/** The knowledge files are inconsistent (e.g. a citation missing from `sources.md`). */
export class CoachKnowledgeError extends Error {
  override name = "CoachKnowledgeError";
}

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads and checks the knowledge files. Throws `CoachKnowledgeError` when they are inconsistent. */
export function loadCoachKnowledge({ environment, dir = packageDir }: LoadCoachKnowledgeOptions): CoachKnowledge {
  const sources = new Map(parseSources(readFileSync(path.join(dir, "sources.md"), "utf8")).map((source) => [source.id, source]));
  const read = (file: string) => readDocument(file, readFileSync(path.join(dir, file), "utf8"), sources);
  const served = <T extends KnowledgeDocument>(document: T) => environment !== "production" || document.humanValidated;

  const playbooks = readdirSync(path.join(dir, "playbooks"))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((file) => {
      const id = file.replace(/\.md$/, "");
      if (!(PLAYBOOK_IDS as readonly string[]).includes(id)) throw new CoachKnowledgeError(`Unknown playbook ${id}`);
      return { id: id as PlaybookId, ...read(path.join("playbooks", file)) };
    })
    .filter(served);
  const byId = new Map(playbooks.map((playbook) => [playbook.id, playbook]));
  const digest = read("core-digest.md");

  return {
    playbook: (id) => byId.get(id),
    playbooks: () => [...playbooks],
    coreDigest: () => (served(digest) ? digest : undefined),
  };
}

function readDocument(file: string, markdown: string, sources: Map<string, Source>): KnowledgeDocument {
  const { frontmatter, title, body, rules } = parsePlaybook(markdown);
  const sourceIds = Array.isArray(frontmatter.sources) ? frontmatter.sources : [];
  const unknown = [...new Set([...sourceIds, ...citedSourceIds(markdown)])].filter((sourceId) => !sources.has(sourceId));
  if (unknown.length > 0) throw new CoachKnowledgeError(`${file} cites sources missing from sources.md: ${unknown.join(", ")}`);
  const status = String(frontmatter.statut ?? "");
  return {
    title,
    version: String(frontmatter.version ?? ""),
    updated: String(frontmatter.updated ?? ""),
    status,
    humanValidated: isHumanValidated(status),
    rules: rules.map((rule) => ({ ...rule, sourceIds: citedSourceIds(`${rule.title}\n${rule.text}`) })),
    sources: sourceIds.map((sourceId) => sources.get(sourceId)!),
    text: body,
  };
}

/** "validé (François Nader, 2026-10-10)" is a human validation; "validé (auto-QA Claude, …)" or a draft is not. */
function isHumanValidated(status: string): boolean {
  const reviewer = /^validée?\s*\((.+)\)\s*$/i.exec(status.trim())?.[1];
  return reviewer !== undefined && !/auto|claude|\b(?:ia|ai|llm)\b/i.test(reviewer);
}
