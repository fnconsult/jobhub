import type { Page } from "@playwright/test";

export type RenderedText = {
  text: string;
  tag: string;
  fontSizePx: number;
  color: string;
  background: string;
  contrast: number;
};

/**
 * Collects every visible piece of text on the page as the browser rendered it:
 * computed font size, text colour, the effective background behind it, and the
 * WCAG 2.1 contrast ratio between the two (computed from the spec formula).
 */
export async function renderedTexts(page: Page): Promise<RenderedText[]> {
  return page.evaluate(() => {
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
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el || el.closest("script, style, option, noscript")) continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || rect.width === 0) continue;
      const color = style.color;
      const background = backgroundOf(el);
      const [l1, l2] = [luminance(parse(color)), luminance(parse(background))].sort((a, b) => b - a);
      results.push({
        text,
        tag: el.tagName.toLowerCase(),
        fontSizePx: parseFloat(style.fontSize),
        color,
        background,
        contrast: (l1! + 0.05) / (l2! + 0.05),
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
      });
    }
    return results;
  });
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
