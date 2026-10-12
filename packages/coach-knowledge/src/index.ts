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
  rules: PlaybookRule[];
  /** The frontmatter `sources`, resolved against `sources.md`. */
  sources: Source[];
};

export type KnowledgeEnvironment = "production" | "development" | "eval";

export type CoachKnowledge = {
  playbook(id: PlaybookId): Playbook | undefined;
};

export type LoadCoachKnowledgeOptions = {
  environment: KnowledgeEnvironment;
  /** The folder holding `playbooks/` and `sources.md`. Defaults to this package's own. */
  dir?: string;
};

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadCoachKnowledge({ dir = packageDir }: LoadCoachKnowledgeOptions): CoachKnowledge {
  const sources = new Map(parseSources(readFileSync(path.join(dir, "sources.md"), "utf8")).map((source) => [source.id, source]));
  const playbooksDir = path.join(dir, "playbooks");
  const playbooks = new Map<string, Playbook>();
  for (const file of readdirSync(playbooksDir).filter((name) => name.endsWith(".md")).sort()) {
    const parsed = parsePlaybook(readFileSync(path.join(playbooksDir, file), "utf8"));
    const { frontmatter } = parsed;
    const id = String(frontmatter.playbook ?? file.replace(/\.md$/, "")) as PlaybookId;
    const sourceIds = Array.isArray(frontmatter.sources) ? frontmatter.sources : [];
    playbooks.set(id, {
      id,
      title: parsed.title,
      version: String(frontmatter.version ?? ""),
      updated: String(frontmatter.updated ?? ""),
      status: String(frontmatter.statut ?? ""),
      rules: parsed.rules.map((rule) => ({ ...rule, sourceIds: citedSourceIds(`${rule.title}\n${rule.text}`) })),
      sources: sourceIds.flatMap((sourceId) => sources.get(sourceId) ?? []),
    });
  }
  return { playbook: (id) => playbooks.get(id) };
}
