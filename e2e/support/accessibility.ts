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
  /** The Density the text sits in (ADR-0053): Compact inside `[data-density="compact"]` (the Back Office), else Confort. */
  density: "confort" | "compact";
};

/**
 * Where metadata text sits (see RenderedText.metadata): a Provenance line, what an action spent, a count beside a
 * Back Office section, a chart's axis and threshold labels (whose values the table under each chart also gives).
 */
const METADATA = ".provenance-line, .live-action-spent, .chat-stopped-spent, .sidebar-count, .chart-axis, .chart-x, .chart-threshold-label";

/** The smallest body and metadata text of each Density, in px (ADR-0009 and its amendments). */
const FLOORS = { confort: { body: 16, meta: 13 }, compact: { body: 14, meta: 12.5 } } as const;

/**
 * The smallest font size a rendered text may have (ADR-0009): 16 px, or 13 px for metadata, in Confort;
 * 14 px, or 12.5 px for metadata, in Compact.
 */
export const fontFloorOf = (text: RenderedText): number => FLOORS[text.density][text.metadata ? "meta" : "body"];

/**
 * Collects every visible piece of text on the page as the browser rendered it:
 * computed font size, text colour, the effective background behind it, and the
 * WCAG 2.1 contrast ratio between the two (computed from the spec formula).
 * A sentence whose glossary term is a HelpTerm button (#343) is one text, as the catalogue has it, not three pieces.
 * Metadata text is left out: the ADR-0009 amendment (#317) lets it be smaller than body text,
 * at least 13px (12.5px in Compact) in the metadata colour, `--color-text-meta` (AA on every surface), e.g. AI
 * Activity's summary and the Provenance line. Smaller text in that colour is still collected, and so held to the
 * body-text floor.
 */
export async function renderedTexts(page: Page): Promise<RenderedText[]> {
  return page.evaluate(({ metadata, floors }) => {
    // Metadata text (ADR-0009 amendment): the metadata colour token, as the browser computes it.
    const probe = document.createElement("span");
    probe.style.color = "var(--color-text-meta)";
    document.body.append(probe);
    const META_COLOR = getComputedStyle(probe).color;
    probe.remove();
    const densityOf = (el: Element): "confort" | "compact" => (el.closest('[data-density="compact"]') ? "compact" : "confort");
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
      const density = densityOf(el);
      if (color === META_COLOR && parseFloat(style.fontSize) >= floors[density].meta) continue;
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
        density,
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
        density: densityOf(select),
      });
    }
    return results;
  }, { metadata: METADATA, floors: FLOORS });
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
