import { describe, expect, it } from "vitest";
import { auditStylesheet } from "./index";

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
