/**
 * An AI Coach reply, as the Coach Panel shows it (#164): the Markdown models
 * write turned into paragraphs, lists and bold or italic text, so the Candidate
 * never sees a raw `**`. No server-only imports: the Coach Panel bundles it.
 */

/** A run of text and how it is set. */
export interface Inline {
  text: string;
  strong: boolean;
  emphasis: boolean;
}

/** One line of a paragraph or of a list item. */
export type Line = Inline[];

/**
 * A paragraph, or a list: bulleted, or numbered from `start`. Headings are bold
 * paragraphs; quotes are plain text; horizontal rules are left out.
 */
export type CoachReplyBlock = { kind: "paragraph"; lines: Line[] } | { kind: "list"; ordered: boolean; start: number; items: Line[][] };

/**
 * What sets text apart in a line, first match wins: ***both***, **bold** or __bold__,
 * *italic* or _italic_ (not inside a word, as in mon_cv_2026 or 2*3*4), `code`, and
 * [links](https://…). Markers hug their text: `5 * 3` is a sum.
 */
const MARKUP = new RegExp(
  [
    String.raw`(?<both>\*\*\*|___)(?=\S)(?<bothText>.+?)(?<=\S)\k<both>`,
    String.raw`(?<bold>\*\*|__)(?=\S)(?<boldText>.+?)(?<=\S)\k<bold>`,
    String.raw`(?<![\p{L}\p{N}*])\*(?=\S)(?<starText>[^*\n]+?)(?<=\S)\*(?![\p{L}\p{N}*])`,
    String.raw`(?<![\p{L}\p{N}_])_(?=\S)(?<underscoreText>[^_\n]+?)(?<=\S)_(?![\p{L}\p{N}_])`,
    String.raw`\x60(?<code>[^\x60\n]+)\x60`,
    String.raw`\[(?<linkText>[^\]\n]+)\]\([^)\s]+\)`,
  ].join("|"),
  "gu",
);

type Marks = Pick<Inline, "strong" | "emphasis">;

function inlinesOf(text: string, marks: Marks, into: Inline[]): Inline[] {
  // A ** or __ left unclosed marks nothing: it goes.
  const add = (piece: string, set: Marks) => {
    const shown = piece.replace(/\*\*|__/g, "");
    if (shown) into.push({ text: shown, ...set });
  };
  let at = 0;
  for (const match of text.matchAll(MARKUP)) {
    add(text.slice(at, match.index), marks);
    const { bothText, boldText, starText, underscoreText, code, linkText } = match.groups!;
    if (bothText !== undefined) inlinesOf(bothText, { strong: true, emphasis: true }, into);
    else if (boldText !== undefined) inlinesOf(boldText, { ...marks, strong: true }, into);
    else if ((starText ?? underscoreText) !== undefined) inlinesOf((starText ?? underscoreText)!, { ...marks, emphasis: true }, into);
    else if (linkText !== undefined) inlinesOf(linkText, marks, into);
    else add(code!, marks);
    at = match.index + match[0].length;
  }
  add(text.slice(at), marks);
  return into;
}

/** The runs of `text`, neighbours set alike merged into one. */
function inlines(text: string, marks: Marks = { strong: false, emphasis: false }): Line {
  const line: Line = [];
  for (const inline of inlinesOf(text, marks, [])) {
    const last = line.at(-1);
    if (last && last.strong === inline.strong && last.emphasis === inline.emphasis) last.text += inline.text;
    else line.push(inline);
  }
  return line;
}

const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const HEADING = /^#{1,6}\s+(.+)$/;
const ITEM = /^(?:[-*+•]|(?<number>\d{1,9})[.)])\s+(?<text>.+)$/u;

type List = Extract<CoachReplyBlock, { kind: "list" }>;

/** The blocks of the AI Coach reply `text`, in order. */
export function coachReplyBlocks(text: string): CoachReplyBlock[] {
  const blocks: CoachReplyBlock[] = [];
  // Lines go on in the open paragraph, or list item, until a blank line or another block comes between.
  let paragraph: Line[] | null = null;
  let list: List | null = null;
  let item: Line[] | null = null;
  let afterBlank = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      afterBlank = true;
      continue;
    }
    const heading = HEADING.exec(line);
    const listItem = ITEM.exec(line);
    if (RULE.test(line) || heading) {
      if (heading) blocks.push({ kind: "paragraph", lines: [inlines(heading[1]!, { strong: true, emphasis: false })] });
      paragraph = list = item = null;
    } else if (listItem) {
      const { number, text: itemText } = listItem.groups!;
      const ordered = number !== undefined;
      // Blank lines between items keep one list: models often space them out.
      if (!list || list.ordered !== ordered) {
        list = { kind: "list", ordered, start: ordered ? Number(number) : 1, items: [] };
        blocks.push(list);
      }
      list.items.push((item = [inlines(itemText!)]));
      paragraph = null;
    } else {
      const shown = inlines(line.replace(/^>\s?/, ""));
      if (item && !afterBlank) item.push(shown);
      else if (paragraph && !afterBlank) paragraph.push(shown);
      else {
        blocks.push({ kind: "paragraph", lines: (paragraph = [shown]) });
        list = item = null;
      }
    }
    afterBlank = false;
  }
  return blocks;
}
