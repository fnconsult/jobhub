import { describe, expect, it } from "vitest";
import { auditComponentStylesheet, auditStylesheet } from "./index";

describe("auditStylesheet", () => {
  it("accepts a stylesheet that stays on the ADR-0009 floor", () => {
    const css = `
      :root { --scrim: rgba(15, 15, 15, 0.4); }
      body { font-size: var(--font-size-body); color: var(--color-text); }
      .hint { font-size: 1rem; color: var(--color-text-secondary); }
      .title { font-size: 1.5rem; }
      .badge { background: var(--color-surface); border: 1px solid var(--color-border); }
    `;
    expect(auditStylesheet(css)).toEqual([]);
  });

  it("flags type set below 16px, in px, rem or em", () => {
    const css = `.a { font-size: 14px; } .b { font-size: 0.875rem; } .c { font-size: .9em; } .d { font-size: 16px; }`;
    expect(auditStylesheet(css).map((v) => [v.rule, v.selector])).toEqual([
      ["min-body-size", ".a"],
      ["min-body-size", ".b"],
      ["min-body-size", ".c"],
    ]);
  });

  it("flags type below 14px on a Compact page, and lets 14px through (ADR-0009 Compact amendment)", () => {
    const css = `.a { font-size: 13px; } .b { font-size: 0.78rem; } .c { font-size: 0.875rem; } .d { font-size: 14px; }`;
    expect(auditStylesheet(css, { density: "compact" }).map((v) => [v.rule, v.selector])).toEqual([
      ["min-body-size", ".a"],
      ["min-body-size", ".b"],
    ]);
    expect(auditStylesheet(css).map((v) => v.selector)).toEqual([".a", ".b", ".c", ".d"]);
  });

  it("accepts every audited text token, and the old names they alias until the components ticket", () => {
    const css = `
      .a { color: var(--color-secondary); }
      .b { color: var(--color-meta); }
      .c { color: var(--color-warn); }
      .d { color: var(--color-text-secondary); }
      .e { color: var(--color-text-meta); }
    `;
    expect(auditStylesheet(css)).toEqual([]);
  });

  it("flags text coloured with anything but an audited text colour", () => {
    const css = `
      .grey { color: var(--color-border); }
      .local { color: var(--muted); }
      .ok { color: var(--color-accent); }
      .on-accent { color: var(--color-on-accent); }
      .inherits { color: inherit; }
    `;
    expect(auditStylesheet(css).map((v) => [v.rule, v.selector])).toEqual([
      ["text-colour", ".grey"],
      ["text-colour", ".local"],
    ]);
  });

  it("flags literal colours outside custom property definitions", () => {
    const css = `
      :root { --scrim: rgba(15, 15, 15, 0.4); --line: #e3e2e0; }
      .card { background: #f0f0f0; }
      .shadow { box-shadow: 0 1px 2px hsl(0 0% 0% / 0.2); }
      .ring { outline: 3px solid RGB(31, 95, 191); }
      .see-through { background: transparent; border-color: currentColor; }
    `;
    expect(auditStylesheet(css).map((v) => [v.rule, v.selector])).toEqual([
      ["literal-colour", ".card"],
      ["literal-colour", ".shadow"],
      ["literal-colour", ".ring"],
    ]);
  });
});

describe("auditComponentStylesheet (#462)", () => {
  it("accepts a component stylesheet that takes every font size and colour from the tokens", () => {
    const css = `
      @layer base, components;
      @layer components {
        .ds-button { font-size: var(--font-size-meta); color: var(--color-on-accent); background: var(--color-accent); }
        .ds-toast { color: var(--color-on-inverse); background: var(--color-inverse); }
        .ds-title { font-size: var(--font-size-h1); }
        .ds-label { font-size: inherit; color: inherit; }
      }
    `;
    expect(auditComponentStylesheet(css)).toEqual([]);
  });

  it("flags a font size that is not a token, even at or above the body floor", () => {
    const css = `@layer components { .a { font-size: 1rem; } .b { font-size: 0.62em; } .c { font-size: calc(var(--font-size-h1) * 2); } .d { font: 500 14px var(--font-sans); } }`;
    expect(auditComponentStylesheet(css).map((v) => [v.rule, v.selector])).toEqual([
      ["font-size-token", ".a"],
      ["font-size-token", ".b"],
      ["font-size-token", ".c"],
      ["font-size-token", ".d"],
    ]);
  });

  it("flags a literal colour, even in a custom property the component defines", () => {
    const css = `@layer components { .a { --knob: #fff; } .b { box-shadow: 0 1px 2px rgb(0 0 0 / 20%); } }`;
    expect(auditComponentStylesheet(css).map((v) => [v.rule, v.selector])).toEqual([
      ["literal-colour", ".a"],
      ["literal-colour", ".b"],
    ]);
  });

  it("still flags text in a colour the tokens do not audit", () => {
    expect(auditComponentStylesheet(".a { color: var(--color-border); }").map((v) => v.rule)).toEqual(["text-colour"]);
  });
});
