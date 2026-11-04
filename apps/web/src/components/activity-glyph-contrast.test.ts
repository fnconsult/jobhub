import { readFileSync } from "node:fs";
import { ACTIVITIES } from "@jobhub/shared";
import { contrastRatio, designTokens, type Theme } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";

// The web app's one stylesheet (ADR-0018): it alone colours the Activity glyph.
const css = readFileSync(new URL("../app/app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Each rule that strokes the glyph: its selector and the colour token it strokes with. */
const glyphStrokes = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, selector]) => selector!.includes(".activity-glyph"))
  .flatMap(([, selector, body]) => {
    const stroke = /(?:^|;|\s)stroke\s*:\s*([^;]+)/.exec(body!);
    return stroke ? [{ selector: selector!.trim(), stroke: stroke[1]!.trim() }] : [];
  });

/** The surfaces AI Activity, the Coach and a file being read put the glyph on. */
const SURFACES = ["background", "canvas", "nav", "surface", "hover"] as const;
const THEMES: Theme[] = ["light", "dark"];
/** WCAG 1.4.11: a graphic that carries meaning, 3:1 (ADR-0009: the activity glyph). */
const NON_TEXT = 3;

describe("the Activity glyph's contrast (ADR-0009), every Activity's, `act`'s too (#726)", () => {
  it("is drawn in one colour for every Activity: no Activity's glyph has a colour of its own", () => {
    expect(ACTIVITIES).toContain("act");
    expect(glyphStrokes.length).toBeGreaterThan(0);
    for (const { selector } of glyphStrokes) expect(selector).not.toMatch(/data-activity/);
  });

  it("is the accent while its step runs, the metadata colour once it ended", () => {
    expect(new Set(glyphStrokes.map(({ stroke }) => stroke))).toEqual(new Set(["var(--color-accent)", "var(--color-text-meta)"]));
  });

  it.each(THEMES)("meets 3:1 as a graphic on every surface it sits on, in the %s theme", (theme) => {
    for (const token of ["accent", "meta"] as const) {
      for (const surface of SURFACES) {
        const ratio = contrastRatio(designTokens.color[token][theme], designTokens.color[surface][theme]);
        expect(ratio, `${token} on ${surface} (${theme})`).toBeGreaterThanOrEqual(NON_TEXT);
      }
    }
  });
});
