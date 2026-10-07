/**
 * A Job Offer's full text, as captured, laid out for reading: paragraphs,
 * bulleted or numbered lists, and the short headings postings use ("Vos
 * missions :", "PROFIL RECHERCHÉ"). Nothing is dropped or reworded: every
 * non-blank line of the posting is in exactly one block.
 */
export type ContentBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; items: string[] };

/** "- ", "• ", "* ", "– ", "· ", "1. ", "2) ". */
const BULLET = /^(?:[-•*–·▪◦]|\d{1,2}[.)])\s+/;
const HEADING_MAX_LENGTH = 60;

function looksLikeHeading(line: string): boolean {
  if (line.length > HEADING_MAX_LENGTH) return false;
  const inCapitals = /\p{L}/u.test(line) && line === line.toLocaleUpperCase("fr");
  return line.endsWith(":") || inCapitals;
}

export function contentBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const chunk of content.replaceAll("\r\n", "\n").split(/\n\s*\n/)) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // Runs of consecutive list items, or of consecutive text lines.
    const runs: ContentBlock[] = [];
    for (const line of lines) {
      const last = runs.at(-1);
      if (BULLET.test(line)) {
        const item = line.replace(BULLET, "");
        if (last?.kind === "list") last.items.push(item);
        else runs.push({ kind: "list", items: [item] });
      } else if (last?.kind === "paragraph") last.lines.push(line);
      else runs.push({ kind: "paragraph", lines: [line] });
    }
    // A single short line that stands alone, or introduces a list, is a heading.
    runs.forEach((run, index) => {
      const next = runs[index + 1];
      const standsAlone = runs.length === 1 || next?.kind === "list";
      if (run.kind === "paragraph" && run.lines.length === 1 && standsAlone && looksLikeHeading(run.lines[0]!)) {
        blocks.push({ kind: "heading", text: run.lines[0]! });
      } else blocks.push(run);
    });
  }
  return blocks;
}
