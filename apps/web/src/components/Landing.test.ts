import { readFileSync } from "node:fs";
import { auditComponentStylesheet } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./Landing.css", import.meta.url), "utf8");

describe("the landing page's stylesheet (ADR-0105)", () => {
  it("takes every font size and colour from the tokens, like a Design System component's", () => {
    expect(auditComponentStylesheet(css)).toEqual([]);
  });

  it("holds its rules in the components layer, under the pages' own", () => {
    const source = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(source.startsWith("@layer base, components;")).toBe(true);
    expect(source.slice("@layer base, components;".length).trim().startsWith("@layer components {")).toBe(true);
  });

  it("names its own type sizes in rem, so the Text Size scales them", () => {
    const sizes = [...css.matchAll(/--font-size-landing-[a-z0-9-]+:\s*([^;]+);/g)].map((match) => match[1]!);
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size, size).not.toMatch(/\d(?:px|pt)\b/);
  });

  it("moves only where motion is welcome: every animation is under prefers-reduced-motion: no-preference", () => {
    const welcome = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n {2}\}\n/.exec(css)![1]!;
    const outside = css.replace(welcome, "");
    expect(welcome).toMatch(/animation:/);
    expect(outside).not.toMatch(/^\s*animation(?:-name)?:/m);
  });
});
