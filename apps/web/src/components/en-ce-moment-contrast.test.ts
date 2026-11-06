import { readFileSync } from "node:fs";
import { contrastRatio, designTokens, legacyColorAliases, type Theme } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";

// The web app's one stylesheet (ADR-0018): it alone colours « En ce moment » (#806).
const css = readFileSync(new URL("../app/app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector!.split(",").map((part) => part.trim()), body: body! }));

type Colour = keyof typeof designTokens.color;
const camel = (name: string) => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The colour token a rule of `selector` sets for `property`, an alias read as the token it stands for. */
function tokenOf(selector: string, property: "background" | "stroke" | "color"): Colour {
  const rule = rules.find((each) => each.selectors.includes(selector));
  const name = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*var\\(--color-([a-z-]+)\\)`).exec(rule?.body ?? "")?.[1];
  expect(name, `${property} of ${selector}`).toBeDefined();
  const token = camel(name!);
  return (legacyColorAliases[token as keyof typeof legacyColorAliases] ?? token) as Colour;
}

const THEMES: Theme[] = ["light", "dark"];
/** WCAG 1.4.11: a graphic that carries meaning, 3:1; WCAG 1.4.3: text, 4.5:1 (ADR-0009). */
const NON_TEXT = 3;
const TEXT = 4.5;

describe("« En ce moment »'s contrast (ADR-0009, #806)", () => {
  // The block with nothing running, while an action runs, an action, and a stopped or failed one in light red.
  const surfaces = () => ({
    nothing: tokenOf(".en-ce-moment", "background"),
    running: tokenOf(".en-ce-moment[data-running]", "background"),
    action: tokenOf(".en-ce-moment-action", "background"),
    stopped: tokenOf('.ai-activity-live[data-status="stopped"]', "background"),
    failed: tokenOf('.ai-activity-live[data-status="failed"]', "background"),
  });

  it("is a quiet card with nothing running, the accent's soft tint while an action runs, a stopped or failed action in very light red", () => {
    expect(surfaces()).toEqual({ nothing: "surface", running: "accentSoft", action: "background", stopped: "dangerSoft", failed: "dangerSoft" });
  });

  it("draws an ended action's glyph still, in the metadata colour; a running one's in the accent", () => {
    expect(tokenOf('.en-ce-moment-action:not([data-status="running"]):not([data-status="stopping"]) > .activity-glyph', "stroke")).toBe("meta");
    expect(tokenOf(".activity-glyph", "stroke")).toBe("accent");
  });

  it.each(THEMES)("the glyph meets 3:1 and the words 4.5:1 on each of its surfaces, in the %s theme", (theme) => {
    const on = (fg: Colour, bg: Colour) => contrastRatio(designTokens.color[fg][theme], designTokens.color[bg][theme]);
    for (const [where, surface] of Object.entries(surfaces())) {
      // The glyph, live or still; the tool steps' accent dot and metadata tick.
      for (const glyph of ["accent", "meta"] as const) expect(on(glyph, surface), `${glyph} glyph on ${where} (${theme})`).toBeGreaterThanOrEqual(NON_TEXT);
      // Its kind and step, « 2 étapes finies · 12 s », « Rien ne tourne sur cette page. », the link to its page.
      for (const words of ["text", "secondary", "meta", "accent"] as const) expect(on(words, surface), `${words} on ${where} (${theme})`).toBeGreaterThanOrEqual(TEXT);
    }
  });
});
