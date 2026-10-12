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

export type Playbook = {
  id: PlaybookId;
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
};

export type KnowledgeEnvironment = "production" | "development" | "eval";

/**
 * In "production" only playbooks a human validated are served; "development" and "eval"
 * get every playbook, so unvalidated ones can be tried and measured before they ship.
 */
export type CoachKnowledge = {
  /** The playbook, or undefined when it does not exist or is not served in this environment. */
  playbook(id: PlaybookId): Playbook | undefined;
  /** The playbooks served in this environment, by id. */
  playbooks(): Playbook[];
};

export type LoadCoachKnowledgeOptions = {
  environment: KnowledgeEnvironment;
  /** The folder holding `playbooks/` and `sources.md`. Defaults to this package's own. */
  dir?: string;
};

/** The knowledge files are inconsistent (e.g. a citation missing from `sources.md`). */
export class CoachKnowledgeError extends Error {
  override name = "CoachKnowledgeError";
}

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadCoachKnowledge({ environment, dir = packageDir }: LoadCoachKnowledgeOptions): CoachKnowledge {
  const sources = new Map(parseSources(readFileSync(path.join(dir, "sources.md"), "utf8")).map((source) => [source.id, source]));
  const playbooksDir = path.join(dir, "playbooks");
  const playbooks = new Map<string, Playbook>();
  for (const file of readdirSync(playbooksDir).filter((name) => name.endsWith(".md")).sort()) {
    const markdown = readFileSync(path.join(playbooksDir, file), "utf8");
    const parsed = parsePlaybook(markdown);
    const { frontmatter } = parsed;
    const id = String(frontmatter.playbook ?? file.replace(/\.md$/, "")) as PlaybookId;
    const sourceIds = Array.isArray(frontmatter.sources) ? frontmatter.sources : [];
    const unknown = [...new Set([...sourceIds, ...citedSourceIds(markdown)])].filter((sourceId) => !sources.has(sourceId));
    if (unknown.length > 0) throw new CoachKnowledgeError(`Playbook ${id} cites sources missing from sources.md: ${unknown.join(", ")}`);
    playbooks.set(id, {
      id,
      title: parsed.title,
      version: String(frontmatter.version ?? ""),
      updated: String(frontmatter.updated ?? ""),
      status: String(frontmatter.statut ?? ""),
      humanValidated: isHumanValidated(String(frontmatter.statut ?? "")),
      rules: parsed.rules.map((rule) => ({ ...rule, sourceIds: citedSourceIds(`${rule.title}\n${rule.text}`) })),
      sources: sourceIds.map((sourceId) => sources.get(sourceId)!),
    });
  }
  const served = [...playbooks.values()].filter((playbook) => environment !== "production" || playbook.humanValidated);
  const servedById = new Map(served.map((playbook) => [playbook.id, playbook]));
  return { playbook: (id) => servedById.get(id), playbooks: () => [...served] };
}

/** "validé (François Nader, 2026-10-10)" is a human validation; "validé (auto-QA Claude, …)" or a draft is not. */
function isHumanValidated(status: string): boolean {
  const reviewer = /^validée?\s*\((.+)\)\s*$/i.exec(status.trim())?.[1];
  return reviewer !== undefined && !/auto|claude|\b(?:ia|ai|llm)\b/i.test(reviewer);
}
