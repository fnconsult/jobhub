/**
 * Which font draws each character of a PDF.
 *
 * The standard PDF fonts (Times, Helvetica) are never embedded and always
 * extractable, but they only encode WinAnsi (Western European) characters.
 * Anything else (Ł, Ğ, →, ✓, Cyrillic, Greek, CJK, emoji) would come out as
 * garbage. So a document whose text is all WinAnsi keeps the standard fonts,
 * and any other document is drawn in an embedded Unicode font (DejaVu), with
 * DejaVu Sans (Arabic, Hebrew, symbols missing from DejaVu Serif), Noto Sans
 * Devanagari, Noto Sans Thai, Noto Sans SC (CJK), Noto Sans KR (Hangul) and
 * Noto Emoji for the characters it has no glyph for. WOFF, not WOFF2: fontkit
 * cannot subset some WOFF2 glyphs (flags crash it); and the WOFF files are
 * unpacked here, not by fontkit (see fontBytes).
 * pdfkit subsets embedded fonts and writes a ToUnicode map, so the text stays
 * extractable by ATS parsers.
 *
 * Font files are read from `node_modules` at run time (see
 * `outputFileTracingIncludes` in next.config.ts for the standalone build).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import * as fontkit from "fontkit";
import koreanSlices from "@fontsource/noto-sans-kr/unicode.json";
import cjkSlices from "@fontsource/noto-sans-sc/unicode.json";
import devanagariSlices from "@fontsource/noto-sans-devanagari/unicode.json";
import thaiSlices from "@fontsource/noto-sans-thai/unicode.json";

/** Characters the standard PDF fonts can draw: WinAnsiEncoding (Windows-1252). */
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function isWinAnsi(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const ok = code === 0x0a || code === 0x0d || code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(char);
    if (!ok) return false;
  }
  return true;
}

/**
 * The path of `file` inside an installed package, found from `from` (the app,
 * or the repo root in tests) up to the root. Looks for the file itself: the
 * standalone build traces font files without their package.json.
 */
export function findFontFile(pkg: string, file: string, from = process.cwd()): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", pkg, file);
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) throw new Error(`Font file ${pkg}/${file} is not installed`);
  }
}
const fontFiles = new Map<string, string>();
function fontFile(pkg: string, file: string): string {
  const key = `${pkg}/${file}`;
  let found = fontFiles.get(key);
  if (!found) {
    found = findFontFile(pkg, file);
    fontFiles.set(key, found);
  }
  return found;
}

/**
 * The bytes of a font file, as TrueType/OpenType. A WOFF file is unpacked here
 * with Node's zlib: fontkit's own inflater (tiny-inflate) rejects some valid
 * WOFF tables (the cmap of Noto Sans SC slice [101]: "Data error").
 */
const fontBytesCache = new Map<string, Buffer>();
export function fontBytes(file: string): Buffer {
  let bytes = fontBytesCache.get(file);
  if (!bytes) {
    const raw = readFileSync(file);
    bytes = raw.toString("latin1", 0, 4) === "wOFF" ? sfntOfWoff(raw) : raw;
    fontBytesCache.set(file, bytes);
  }
  return bytes;
}

/** Unpacks a WOFF 1.0 file into the TrueType/OpenType font it wraps (W3C WOFF spec, section 4). */
function sfntOfWoff(woff: Buffer): Buffer {
  const count = woff.readUInt16BE(12);
  const tables = Array.from({ length: count }, (_, i) => {
    const entry = 44 + i * 20;
    const [offset, compLength, length] = [woff.readUInt32BE(entry + 4), woff.readUInt32BE(entry + 8), woff.readUInt32BE(entry + 12)];
    const stored = woff.subarray(offset, offset + compLength);
    const data = compLength < length ? inflateSync(stored) : stored;
    if (data.length !== length) throw new Error(`Corrupt WOFF table ${woff.toString("latin1", entry, entry + 4)}`);
    return { tag: woff.subarray(entry, entry + 4), checksum: woff.readUInt32BE(entry + 16), data };
  });
  const headerLength = 12 + count * 16;
  const sfnt = Buffer.alloc(headerLength + tables.reduce((sum, t) => sum + ((t.data.length + 3) & ~3), 0));
  let searchRange = 1;
  let entrySelector = 0;
  while (searchRange * 2 <= count) {
    searchRange *= 2;
    entrySelector++;
  }
  sfnt.writeUInt32BE(woff.readUInt32BE(4), 0); // flavor
  sfnt.writeUInt16BE(count, 4);
  sfnt.writeUInt16BE(searchRange * 16, 6);
  sfnt.writeUInt16BE(entrySelector, 8);
  sfnt.writeUInt16BE(count * 16 - searchRange * 16, 10);
  let offset = headerLength;
  tables.forEach((table, i) => {
    const entry = 12 + i * 16;
    table.tag.copy(sfnt, entry);
    sfnt.writeUInt32BE(table.checksum, entry + 4);
    sfnt.writeUInt32BE(offset, entry + 8);
    sfnt.writeUInt32BE(table.data.length, entry + 12);
    table.data.copy(sfnt, offset);
    offset += (table.data.length + 3) & ~3;
  });
  return sfnt;
}

type Range = [number, number];
interface Slice {
  file: (weight: 400 | 700) => string;
  ranges: Range[];
}

/** The slices of a Fontsource font, one file per range of characters and per weight (see its unicode.json). */
function slicesOf(table: Record<string, string>, pkg: string, family: string, only?: string[]): Slice[] {
  return Object.entries(table)
    .filter(([key]) => !only || only.includes(key))
    .map(([key, value]) => {
      const name = key.replace(/^\[(.*)\]$/, "$1");
      const ranges = value.split(",").map((range): Range => {
        const [from = "", to = from] = range.trim().replace(/^U\+/i, "").split("-");
        return [parseInt(from, 16), parseInt(to, 16)];
      });
      return { ranges, file: (weight) => fontFile(pkg, `files/${family}-${name}-${weight}-normal.woff`) };
    });
}

/** Fonts tried in turn for a character the template's DejaVu lacks: each says which file might draw it. */
const DEVANAGARI = slicesOf(devanagariSlices, "@fontsource/noto-sans-devanagari", "noto-sans-devanagari", ["devanagari"]);
const THAI = slicesOf(thaiSlices, "@fontsource/noto-sans-thai", "noto-sans-thai", ["thai"]);
const CJK = slicesOf(cjkSlices, "@fontsource/noto-sans-sc", "noto-sans-sc");
const HANGUL = slicesOf(koreanSlices, "@fontsource/noto-sans-kr", "noto-sans-kr");
const EMOJI = "files/noto-emoji-emoji-400-normal.woff";
const sliceFor = (slices: Slice[]) => (code: number, bold: boolean) =>
  slices.find((s) => s.ranges.some(([from, to]) => code >= from && code <= to))?.file(bold ? 700 : 400);
const FALLBACKS: ((code: number, bold: boolean) => string | undefined)[] = [
  // DejaVu Serif lacks Arabic, Hebrew and many symbols that DejaVu Sans has.
  (_, bold) => primaryFile("DejaVuSans", bold),
  sliceFor(DEVANAGARI),
  sliceFor(THAI),
  sliceFor(CJK),
  sliceFor(HANGUL),
  // Emoji in one file, in one weight, so that sequences (👩‍💻, flags) find their ligatures.
  () => fontFile("@fontsource/noto-emoji", EMOJI),
];

/** Every font file a PDF may embed. */
export function allFontFiles(): string[] {
  const families: UnicodeFamily[] = ["DejaVuSerif", "DejaVuSans"];
  return [
    ...families.flatMap((family) => [primaryFile(family, false), primaryFile(family, true)]),
    ...[DEVANAGARI, THAI, CJK, HANGUL].flatMap((slices) => slices.flatMap((slice) => [slice.file(400), slice.file(700)])),
    fontFile("@fontsource/noto-emoji", EMOJI),
  ];
}

/** The embedded Unicode font that replaces a template's standard font. */
export type UnicodeFamily = "DejaVuSerif" | "DejaVuSans";
function primaryFile(family: UnicodeFamily, bold: boolean): string {
  return fontFile("dejavu-fonts-ttf", `ttf/${family}${bold ? "-Bold" : ""}.ttf`);
}

const coverage = new Map<string, fontkit.Font>();
function hasGlyph(file: string, code: number): boolean {
  let font = coverage.get(file);
  if (!font) {
    font = fontkit.create(fontBytes(file)) as fontkit.Font;
    coverage.set(file, font);
  }
  return font.hasGlyphForCodePoint(code);
}

/** Joiners, variation selectors, skin tones and combining marks stay with the character before them (and a joiner with the one after it). */
const ATTACHED: [number, number][] = [
  [0x0300, 0x036f], // combining diacritical marks
  [0x200c, 0x200d], // zero-width (non-)joiners
  [0x20d0, 0x20ff], // combining marks for symbols
  [0xfe00, 0xfe0f], // variation selectors
  [0x1f3fb, 0x1f3ff], // skin tones
  [0xe0020, 0xe007f], // tag characters (subdivision flags)
];
const isAttached = (code: number) => ATTACHED.some(([from, to]) => code >= from && code <= to);

export interface Run {
  /** A font file to embed, or undefined for the template's standard font. */
  file?: string;
  text: string;
}

/**
 * Splits `text` into runs of characters drawn with the same font. `family` is
 * undefined when the whole document fits the standard fonts.
 */
export function runsOf(text: string, family: UnicodeFamily | undefined, bold: boolean): Run[] {
  if (!family) return [{ text }];
  const primary = primaryFile(family, bold);
  const runs: Run[] = [];
  for (const char of text) {
    const last = runs.at(-1);
    const attached = last && (isAttached(char.codePointAt(0)!) || last.text.endsWith("\u200d"));
    const code = char.codePointAt(0)!;
    // A space stays in the font of the text before it when that font has one, so that words of one script make one run.
    const sticky = last && /\s/.test(char) && last.file !== undefined && hasGlyph(last.file, code);
    const file = attached || sticky ? last.file : fontFor(code, primary, bold);
    if (last && last.file === file) last.text += char;
    else runs.push({ file, text: char });
  }
  return runs;
}

function fontFor(code: number, primary: string, bold: boolean): string {
  if (code <= 0x20 || hasGlyph(primary, code)) return primary;
  for (const fallback of FALLBACKS) {
    const file = fallback(code, bold);
    if (file && hasGlyph(file, code)) return file;
  }
  // No font has it: DejaVu draws its "missing glyph" box.
  return primary;
}

/** Letters of the scripts written right to left. */
const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const LTR_LETTER = /(?![\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}])\p{L}/u;
export const isRightToLeft = (text: string) => RTL.test(text);

/** A piece of a line: left-to-right text, or a right-to-left passage with its words in the order they are seen. */
export interface Passage {
  text: string;
  rightToLeft: boolean;
}

/**
 * `text` cut into left-to-right text and right-to-left passages, each passage
 * with its words in the order they are seen, left to right ("محمد علي" becomes
 * "علي محمد"). fontkit already draws the letters of each word from right to
 * left, but pdfkit places words left to right, so a name would read backwards.
 * Text extractors (pdf.js, ATS parsers) put such a passage back in reading
 * order.
 *
 * As in the Unicode bidirectional algorithm, in a left-to-right line: a
 * passage starts at a right-to-left word and runs up to the last right-to-left
 * word or number before the next left-to-right letter. Numbers inside it
 * ("محمد 2024 علي") are part of it: they keep their place among its words.
 */
export function passagesOf(text: string): Passage[] {
  const tokens = text.split(/(\s+)/);
  const ltr = (token: string) => LTR_LETTER.test(token);
  const anchors = (token: string) => !ltr(token) && (RTL.test(token) || /\p{N}/u.test(token));
  const passages: Passage[] = [];
  const push = (text: string, rightToLeft: boolean) => {
    const last = passages.at(-1);
    if (last && !last.rightToLeft && !rightToLeft) last.text += text;
    else if (text) passages.push({ text, rightToLeft });
  };
  for (let i = 0; i < tokens.length; ) {
    if (!(RTL.test(tokens[i]!) && !ltr(tokens[i]!))) {
      push(tokens[i++]!, false);
      continue;
    }
    // The passage ends at its last right-to-left word or number before a left-to-right letter.
    let end = i + 1;
    for (let j = i + 2; j < tokens.length && !ltr(tokens[j]!); j += 2) if (anchors(tokens[j]!)) end = j + 1;
    push(tokens.slice(i, end).reverse().join(""), true);
    i = end;
  }
  return passages;
}

/** `text` with its right-to-left passages in the order they are seen (see passagesOf). */
export const visualOrder = (text: string) =>
  passagesOf(text)
    .map((passage) => passage.text)
    .join("");
