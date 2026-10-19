/**
 * The coaching knowledge as it was written in files before it moved to the Back Office (ADR-0021, #225):
 * the Coaching Playbooks, the Core Digest and the Sources list, read once to be imported as their
 * Playbook Version 1; and the Markdown they are written in (`[Sn]` citations, the Sources table).
 * Server-side only (reads the Markdown files).
 *
 *   const files = readCoachKnowledgeFiles();
 *   files.playbooks[0].text; // the playbook's Markdown, without its frontmatter
 *   citedSourceIds("… [S11][S23]"); // ["S11", "S23"]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { citedSourceIds, parsePlaybook, parseSources, type ParsedSource } from "./parse";

export { citedSourceIds, parseSources } from "./parse";

/** A source a playbook cites as `[Sn]`, from the Sources list. */
export type Source = ParsedSource;

/** One `Rn` rule of a playbook. `sourceIds` are the `[Sn]` it cites. */
export type PlaybookRule = { id: string; title: string; text: string; sourceIds: string[] };

/** A playbook or the Core Digest as read from its file. */
export type KnowledgeDocument = {
  /** Its `# title`. */
  title: string;
  rules: PlaybookRule[];
  /** The Sources it cites, from the Sources list. */
  sources: Source[];
  /** The whole Markdown without its frontmatter. */
  text: string;
};

export type ImportedPlaybook = KnowledgeDocument & { id: string };

export interface CoachKnowledgeFiles {
  /** The Sources list: its whole Markdown, and the sources its table lists. */
  sources: { text: string; entries: Source[] };
  coreDigest: KnowledgeDocument;
  /** By id (the file name). */
  playbooks: ImportedPlaybook[];
}

/** The knowledge files are inconsistent (e.g. a citation missing from `sources.md`). */
export class CoachKnowledgeError extends Error {
  override name = "CoachKnowledgeError";
}

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The `# title` of a playbook's Markdown; "" when it has none. */
export function markdownTitle(markdown: string): string {
  return parsePlaybook(markdown).title;
}

/**
 * Reads and checks the knowledge files of `dir` (default: this package's own `playbooks/`,
 * `core-digest.md` and `sources.md`). Throws `CoachKnowledgeError` when they are inconsistent.
 */
export function readCoachKnowledgeFiles(dir: string = packageDir): CoachKnowledgeFiles {
  const sourcesText = readFileSync(path.join(dir, "sources.md"), "utf8");
  const entries = parseSources(sourcesText);
  const sources = new Map(entries.map((source) => [source.id, source]));
  const read = (file: string) => readDocument(file, readFileSync(path.join(dir, file), "utf8"), sources);

  const playbooks = readdirSync(path.join(dir, "playbooks"))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((file) => ({ id: file.replace(/\.md$/, ""), ...read(path.join("playbooks", file)) }));
  return { sources: { text: sourcesText.trim(), entries }, coreDigest: read("core-digest.md"), playbooks };
}

function readDocument(file: string, markdown: string, sources: Map<string, Source>): KnowledgeDocument {
  const { frontmatter, title, body, rules } = parsePlaybook(markdown);
  const listed = Array.isArray(frontmatter.sources) ? frontmatter.sources : [];
  const cited = citedSourceIds(body);
  const unknown = [...new Set([...listed, ...cited])].filter((sourceId) => !sources.has(sourceId));
  if (unknown.length > 0) throw new CoachKnowledgeError(`${file} cites sources missing from sources.md: ${unknown.join(", ")}`);
  const unlisted = cited.filter((sourceId) => !listed.includes(sourceId));
  if (unlisted.length > 0) throw new CoachKnowledgeError(`${file} cites sources its frontmatter does not list: ${unlisted.join(", ")}`);
  return {
    title,
    rules: rules.map((rule) => ({ ...rule, sourceIds: citedSourceIds(`${rule.title}\n${rule.text}`) })),
    sources: listed.map((sourceId) => sources.get(sourceId)!),
    text: body,
  };
}
