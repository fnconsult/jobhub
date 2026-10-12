/** Parsers for the knowledge files' Markdown. Internal to the package: callers use `loadCoachKnowledge`. */

export type Frontmatter = Record<string, string | string[]>;

export type ParsedPlaybook = {
  frontmatter: Frontmatter;
  title: string;
  rules: { id: string; title: string; text: string }[];
};

export type ParsedSource = { id: string; title: string; author: string; year: string; url: string; licence: string };

/** Splits `---`-delimited frontmatter (flat `key: value` and `key: [a, b]` lines) from the body. */
export function parseFrontmatter(markdown: string): { frontmatter: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { frontmatter: {}, body: markdown };
  const frontmatter: Frontmatter = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    const value = field[2]!.trim();
    const list = /^\[(.*)\]$/.exec(value);
    frontmatter[field[1]!] = list ? list[1]!.split(",").map((item) => unquote(item.trim())).filter(Boolean) : unquote(value);
  }
  return { frontmatter, body: markdown.slice(match[0].length) };
}

function unquote(value: string): string {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

/** Reads a playbook: its `# title` and the `**Rn. Title.**` rules of its `## Règles` section. */
export function parsePlaybook(markdown: string): ParsedPlaybook {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const title = /^# (.+)$/m.exec(body)?.[1]?.trim() ?? "";
  return { frontmatter, title, rules: parseRules(section(body, "Règles")) };
}

/** The lines of a `## heading` section, up to the next `## ` heading. */
function section(body: string, heading: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

function parseRules(lines: string[]): ParsedPlaybook["rules"] {
  const rules: ParsedPlaybook["rules"] = [];
  let current: { id: string; title: string; text: string[] } | undefined;
  const flush = () => {
    if (current) rules.push({ id: current.id, title: current.title, text: current.text.join("\n").trim() });
  };
  for (const line of lines) {
    const heading = /^\*\*(R\d+)\.\s+(.+?)\*\*\s*(.*)$/.exec(line.trim());
    if (heading) {
      flush();
      current = { id: heading[1]!, title: heading[2]!.trim(), text: heading[3] ? [heading[3]] : [] };
    } else if (current) {
      current.text.push(line.trimEnd());
    }
  }
  flush();
  return rules;
}

/** Every `[Sn]` citation in a text, in order of first appearance. */
export function citedSourceIds(text: string): string[] {
  return [...new Set([...text.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]!))];
}

/** Reads the `| ID | Titre | Auteur | Année | URL | Licence | …` table of `sources.md`. */
export function parseSources(markdown: string): ParsedSource[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*S\d+\s*\|/.test(line))
    .map((line) => {
      const [id, title, author, year, url, licence] = line.split("|").slice(1).map((cell) => cell.trim());
      return { id: id!, title: title ?? "", author: author ?? "", year: year ?? "", url: url ?? "", licence: licence ?? "" };
    });
}
