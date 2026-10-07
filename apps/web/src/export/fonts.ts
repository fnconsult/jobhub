/**
 * Which font draws each character of a PDF.
 *
 * The standard PDF fonts (Times, Helvetica) are never embedded and always
 * extractable, but they only encode WinAnsi (Western European) characters.
 * Anything else (Ł, Ğ, →, ✓, Cyrillic, Greek, CJK, emoji) would come out as
 * garbage. So a document whose text is all WinAnsi keeps the standard fonts,
 * and any other document is drawn in an embedded Unicode font (DejaVu), with
 * Noto Sans SC (CJK), Noto Sans KR (Hangul) and Noto Emoji for the characters
 * DejaVu has no glyph for. WOFF, not WOFF2: fontkit cannot subset some WOFF2
 * glyphs (flags crash it).
 * pdfkit subsets embedded fonts and writes a ToUnicode map, so the text stays
 * extractable by ATS parsers.
 *
 * Font files are read from `node_modules` at run time (see
 * `outputFileTracingIncludes` in next.config.ts for the standalone build).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import koreanSlices from "@fontsource/noto-sans-kr/unicode.json";
import cjkSlices from "@fontsource/noto-sans-sc/unicode.json";

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

/** The directory of an installed package, found from where the server runs (the app, or the repo root in tests). */
const packageDirs = new Map<string, string>();
function packageDir(name: string): string {
  const known = packageDirs.get(name);
  if (known) return known;
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) {
      packageDirs.set(name, candidate);
      return candidate;
    }
    if (path.dirname(dir) === dir) throw new Error(`Font package ${name} is not installed`);
  }
}

type Range = [number, number];
interface Slice {
  file: (weight: 400 | 700) => string;
  ranges: Range[];
}

/** The slices of a Fontsource font, one file per range of characters and per weight (see its unicode.json). */
function slicesOf(table: Record<string, string>, pkg: string, family: string): Slice[] {
  return Object.entries(table).map(([key, value]) => {
    const name = key.replace(/^\[(.*)\]$/, "$1");
    const ranges = value.split(",").map((range): Range => {
      const [from = "", to = from] = range.trim().replace(/^U\+/i, "").split("-");
      return [parseInt(from, 16), parseInt(to, 16)];
    });
    return {
      ranges,
      file: (weight) => path.join(packageDir(pkg), "files", `${family}-${name}-${weight}-normal.woff`),
    };
  });
}

/** Fonts tried in turn for a character DejaVu lacks: each says which file might draw it. */
const CJK = slicesOf(cjkSlices, "@fontsource/noto-sans-sc", "noto-sans-sc");
const HANGUL = slicesOf(koreanSlices, "@fontsource/noto-sans-kr", "noto-sans-kr");
const sliceFor = (slices: Slice[]) => (code: number, bold: boolean) =>
  slices.find((s) => s.ranges.some(([from, to]) => code >= from && code <= to))?.file(bold ? 700 : 400);
const FALLBACKS: ((code: number, bold: boolean) => string | undefined)[] = [
  sliceFor(CJK),
  sliceFor(HANGUL),
  // Emoji in one file, in one weight, so that sequences (👩‍💻, flags) find their ligatures.
  () => path.join(packageDir("@fontsource/noto-emoji"), "files", "noto-emoji-emoji-400-normal.woff"),
];

/** The embedded Unicode font that replaces a template's standard font. */
export type UnicodeFamily = "DejaVuSerif" | "DejaVuSans";
function primaryFile(family: UnicodeFamily, bold: boolean): string {
  return path.join(packageDir("dejavu-fonts-ttf"), "ttf", `${family}${bold ? "-Bold" : ""}.ttf`);
}

const coverage = new Map<string, fontkit.Font>();
function hasGlyph(file: string, code: number): boolean {
  let font = coverage.get(file);
  if (!font) {
    font = fontkit.openSync(file) as fontkit.Font;
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
    const file = attached ? last.file : fontFor(char.codePointAt(0)!, primary, bold);
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
