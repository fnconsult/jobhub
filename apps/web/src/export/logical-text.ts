/**
 * Text extractors (pdf.js, ATS parsers) read a PDF's glyphs in the order they
 * are drawn, each glyph standing for the characters its ToUnicode entry gives.
 * Indic fonts draw some glyphs out of the order of their characters: in
 * "शर्मा" the reph (र्) is drawn after the "मा" it precedes, in "विकास" the
 * vowel sign ि is drawn before the "व" it follows. Read glyph by glyph, the
 * name would come back as "शमार्" and "िवकास".
 *
 * So wherever the font reorders glyphs, the glyphs of that cluster get a copy
 * in the embedded font whose ToUnicode entry carries the cluster's characters
 * in reading order: read in drawing order, they give back the text as typed.
 */
import type PDFDocument from "pdfkit";
import { isRightToLeft } from "./fonts";

/**
 * For each glyph drawn left to right (given by the characters it draws), the
 * characters a text extractor should read for it: undefined when its own
 * characters are right, a slice of `text` when the font has reordered it.
 * Reading every glyph in drawing order then gives back `text`.
 */
export function logicalReading(glyphs: number[][], text: string): (number[] | undefined)[] {
  const logical = Array.from(text, (char) => char.codePointAt(0)!);
  if (glyphs.reduce((sum, codes) => sum + codes.length, 0) !== logical.length) return glyphs.map(() => undefined);
  const reading: (number[] | undefined)[] = [];
  let start = 0; // first glyph of the current cluster
  let from = 0; // its first character in `text`
  let read = 0; // characters of `text` covered so far
  const balance = new Map<number, number>();
  const count = (code: number, by: number) => {
    const n = (balance.get(code) ?? 0) + by;
    if (n === 0) balance.delete(code);
    else balance.set(code, n);
  };
  glyphs.forEach((codes, i) => {
    for (const code of codes) {
      count(code, 1);
      count(logical[read++]!, -1);
    }
    if (balance.size > 0) return;
    // Glyphs start..i draw exactly the characters from..read: a cluster.
    const drawn = glyphs.slice(start, i + 1).flat();
    const inOrder = drawn.every((code, k) => code === logical[from + k]);
    let at = from;
    for (let g = start; g <= i; g++) {
      const length = glyphs[g]!.length;
      reading.push(inOrder ? undefined : logical.slice(at, at + length));
      at += length;
    }
    start = i + 1;
    from = read;
  });
  return reading;
}

/** The parts of pdfkit's embedded font (EmbeddedFont, not in its types) that write glyphs and their ToUnicode map. */
interface EmbeddedFont {
  layout(text: string, features?: unknown): { glyphs: { id: number; codePoints: number[]; advanceWidth: number }[]; positions: unknown[] };
  encode(text: string, features?: unknown): [string[], unknown[]];
  subset: { glyphs: number[]; includeGlyph(id: number): number };
  unicode: number[][];
  widths: number[];
  scale: number;
}
const readable = new WeakSet<object>();

/** Makes the font `pdf` draws with now write its reordered clusters so that they extract in reading order. */
export function readInLogicalOrder(pdf: typeof PDFDocument.prototype): void {
  const font = (pdf as unknown as { _font?: Partial<EmbeddedFont> })._font;
  if (!font || typeof font.encode !== "function" || !font.subset || readable.has(font)) return;
  readable.add(font);
  const embedded = font as EmbeddedFont;
  const copies = new Map<string, number>();
  embedded.encode = function (text, features) {
    const { glyphs, positions } = this.layout(text, features);
    // Right-to-left words are drawn reversed on purpose: extractors put them back in reading order themselves.
    const reading = isRightToLeft(text) ? glyphs.map(() => undefined) : logicalReading(glyphs.map((glyph) => glyph.codePoints), text);
    const encoded = glyphs.map((glyph, i) => {
      const chars = reading[i];
      let gid: number;
      if (chars) {
        // A copy of the glyph, with its own ToUnicode entry.
        const key = `${glyph.id}:${chars.join(",")}`;
        gid = copies.get(key) ?? this.subset.glyphs.push(glyph.id) - 1;
        copies.set(key, gid);
        this.unicode[gid] = chars;
      } else {
        gid = this.subset.includeGlyph(glyph.id);
        this.unicode[gid] ??= glyph.codePoints;
      }
      this.widths[gid] ??= glyph.advanceWidth * this.scale;
      return `0000${gid.toString(16)}`.slice(-4);
    });
    return [encoded, positions];
  };
}
