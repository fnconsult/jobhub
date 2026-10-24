import type { Page } from "@playwright/test";

export type RenderedText = {
  text: string;
  tag: string;
  fontSizePx: number;
  color: string;
  background: string;
  contrast: number;
  /**
   * Metadata (ADR-0009 amendment, #317): a Provenance line, or the tokens and time an action spent. It may be smaller,
   * down to `--font-size-meta` (13 px at the standard text size), never under 4.5:1.
   */
  metadata: boolean;
};

/** Where metadata text sits (see RenderedText.metadata). */
const METADATA = ".provenance-line, .live-action-spent, .chat-stopped-spent";

/** The smallest font size a rendered text may have (ADR-0009): 16 px, or 13 px for metadata. */
export const fontFloorOf = (text: RenderedText): number => (text.metadata ? 13 : 16);

/**
 * Collects every visible piece of text on the page as the browser rendered it:
 * computed font size, text colour, the effective background behind it, and the
 * WCAG 2.1 contrast ratio between the two (computed from the spec formula).
 * A sentence whose glossary term is a HelpTerm button (#343) is one text, as the catalogue has it, not three pieces.
 * Metadata text is left out: the ADR-0009 amendment (#317) lets it be smaller than body text,
 * at least 13px in #6b6a67 (5.4:1), e.g. AI Activity's summary and the Provenance line. Smaller
 * text in that colour is still collected, and so held to the body-text floor.
 */
export async function renderedTexts(page: Page): Promise<RenderedText[]> {
  return page.evaluate((metadata: string) => {
    // Metadata text (ADR-0009 amendment): #6b6a67, at least 13px.
    const META_COLOR = "rgb(107, 106, 103)";
    const MIN_META_PX = 13;
    const parse = (value: string): [number, number, number, number] => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) throw new Error(`Unexpected colour: ${value}`);
      const [r, g, b, a = "1"] = m[1]!.split(/[ ,/]+/).filter(Boolean);
      return [Number(r), Number(g), Number(b), Number(a)];
    };
    const luminance = ([r, g, b]: number[]) => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    };
    const backgroundOf = (el: Element | null): string => {
      for (let node = el; node; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (parse(bg)[3] > 0) return bg;
      }
      return "rgb(255, 255, 255)";
    };

    const results: RenderedText[] = [];
    // The element holding a sentence cut by HelpTerms: read once, whole.
    const sentences = new Set<Element>();
    const sentenceOf = (el: Element | null): Element | null =>
      !el ? null : el.classList.contains("help-term") ? el.parentElement : el.querySelector(":scope > .help-term") ? el : null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const sentence = sentenceOf(node.parentElement);
      if (sentence && sentences.has(sentence)) continue;
      if (sentence) sentences.add(sentence);
      const text = (sentence ? sentence.textContent : node.textContent)?.replace(/\s+/g, " ").trim();
      const el = sentence ?? node.parentElement;
      if (!text || !el || el.closest("script, style, option, noscript")) continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || rect.width === 0) continue;
      const color = style.color;
      if (color === META_COLOR && parseFloat(style.fontSize) >= MIN_META_PX) continue;
      const background = backgroundOf(el);
      const [l1, l2] = [luminance(parse(color)), luminance(parse(background))].sort((a, b) => b - a);
      results.push({
        text,
        tag: el.tagName.toLowerCase(),
        fontSizePx: parseFloat(style.fontSize),
        color,
        background,
        contrast: (l1! + 0.05) / (l2! + 0.05),
        metadata: el.closest(metadata) !== null,
      });
    }
    // The selected value of a <select> is rendered text too.
    for (const select of Array.from(document.querySelectorAll("select"))) {
      const style = getComputedStyle(select);
      const color = style.color;
      const background = backgroundOf(select);
      const [l1, l2] = [luminance(parse(color)), luminance(parse(background))].sort((a, b) => b - a);
      results.push({
        text: select.selectedOptions[0]?.textContent?.trim() ?? "",
        tag: "select",
        fontSizePx: parseFloat(style.fontSize),
        color,
        background,
        contrast: (l1! + 0.05) / (l2! + 0.05),
        metadata: false,
      });
    }
    return results;
  }, METADATA);
}

/** Every user-facing string in a nested i18next catalogue. */
export function catalogueStrings(catalogue: unknown): string[] {
  if (typeof catalogue === "string") return [catalogue];
  if (catalogue && typeof catalogue === "object") return Object.values(catalogue).flatMap(catalogueStrings);
  return [];
}

/**
 * Whether `text` is one of the catalogue's strings, its {{placeholders}} filled
 * in (e.g. "de 1 à {{max}}" rendered as "de 1 à 60").
 */
export function fromCatalogue(catalogue: unknown): (text: string) => boolean {
  const strings = catalogueStrings(catalogue);
  const exact = new Set(strings);
  const templates = strings
    // Templates with too little text of their own (e.g. "{{name}} : {{level}}") would let anything through.
    .filter((entry) => /\{\{\s*\w+\s*\}\}/.test(entry) && entry.replace(/\{\{\s*\w+\s*\}\}/g, "").trim().length >= 10)
    .map((entry) => new RegExp(`^${entry.split(/\{\{\s*\w+\s*\}\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+")}$`, "s"));
  return (text) => exact.has(text) || templates.some((template) => template.test(text));
}
