/** Just enough HTML reading for Job discovery: no DOM, regular expressions over the page source. */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const BLOCK = /<\/?(p|div|section|article|header|footer|ul|ol|li|h[1-6]|table|tr|blockquote|pre)\b[^>]*>/gi;

/** The readable text of an HTML fragment: paragraphs separated by a blank line, lines trimmed. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n\n")
    .replace(BLOCK, "\n\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The text of every `<script type="application/ld+json">` block. */
export function jsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    blocks.push(match[1]!);
  }
  return blocks;
}

/** The content of `<meta name="robots">` (and any crawler-specific variant), lower-cased. */
export function metaRobots(html: string): string[] {
  const values: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\bname\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content !== undefined && (name === "robots" || name === "jobbboxbot")) values.push(content.toLowerCase());
  }
  return values;
}
