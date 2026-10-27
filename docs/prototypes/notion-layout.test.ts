import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditStylesheet } from "../../packages/shared/src/design";

// The clickable prototype of the Notion-like layout (#132), published as an artifact.
const html = readFileSync(new URL("./notion-layout.html", import.meta.url), "utf8");

const styles = [...html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map(([, attrs, css]) => ({ attrs: attrs!, css: css! }));

const visibleText = (markup: string) =>
  markup
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

describe("Notion-like layout prototype", () => {
  it("keeps the Notion look's tokens it was drawn with, a frozen record of #132 since ADR-0053 (#461)", () => {
    const tokens = styles.find((s) => s.attrs.includes('id="design-tokens"'));
    expect(tokens?.css).toContain("--color-text: #37352f;");
  });

  it("stays on the ADR-0009 floor in every stylesheet", () => {
    expect(styles.length).toBeGreaterThan(1);
    for (const { css } of styles) expect(auditStylesheet(css)).toEqual([]);
  });

  it("gives every button and link a visible label, never an icon alone", () => {
    const controls = [...html.matchAll(/<(button|a)\b[^>]*>([\s\S]*?)<\/\1>/g)];
    expect(controls.length).toBeGreaterThan(10);
    const unlabelled = controls.filter(([, , inner]) => visibleText(inner!) === "").map(([markup]) => markup);
    expect(unlabelled).toEqual([]);
  });
});
