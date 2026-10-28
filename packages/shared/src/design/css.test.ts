import { describe, expect, it } from "vitest";
import { auditStylesheet, designTokens, renderDesignCss } from "./index";

/** The declarations of the first rule whose selector is exactly `selector` (inside an at-rule or not). */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No rule for ${selector}`);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("renderDesignCss", () => {
  const css = renderDesignCss(designTokens);
  const root = block(css, ":root");

  it("exposes the light theme's colours as CSS custom properties on the root", () => {
    expect(root).toContain("--color-text: #1b1b26;");
    expect(root).toContain("--color-canvas: #ffffff;");
    expect(root).toContain("--color-accent-soft: #eef0fd;");
    expect(root).toContain("--color-chart-1: #6a78ee;");
    expect(root).toContain("--shadow-card: 0 1px 2px rgb(20 20 40 / 4%);");
    expect(root).toContain("color-scheme: light;");
  });

  it("renders the dark values under [data-theme=\"dark\"], which nothing sets yet", () => {
    const dark = block(css, '[data-theme="dark"]');
    expect(dark).toContain("--color-text: #ececf3;");
    expect(dark).toContain("--color-background: #121219;");
    expect(dark).toContain("--shadow-card: none;");
    expect(dark).toContain("color-scheme: dark;");
  });

  it("keeps the old token names as aliases of the new ones, in each theme", () => {
    expect(root).toContain("--color-text-secondary: #575866;");
    expect(root).toContain("--color-text-meta: #686978;");
    expect(root).toContain("--color-surface-hover: #efeff3;");
    expect(root).toContain("--color-danger-surface: #fdeeee;");
    expect(root).toContain("--color-focus-ring: #4f5fe0;");
    expect(block(css, '[data-theme="dark"]')).toContain("--color-text-meta: #9a9bab;");
    expect(root).toContain("--radius-lg: var(--radius-card);");
  });

  it("gives Confort by default: 16px body, 13px metadata, controls 2.5rem, all in rem", () => {
    expect(root).toContain("--font-size-body: 1rem;");
    expect(root).toContain("--font-size-meta: 0.8125rem;");
    expect(root).toContain("--font-size-h1: 2rem;");
    expect(root).toContain("--size-control: 2.5rem;");
    expect(block(css, '[data-density="confort"]')).toContain("--font-size-body: 1rem;");
  });

  it("gives Compact under [data-density=\"compact\"]: 14px body, 12.5px metadata, controls 2rem, tighter rows, still in rem", () => {
    const compact = block(css, '[data-density="compact"]');
    expect(compact).toContain("--font-size-body: 0.875rem;");
    expect(compact).toContain("--font-size-meta: 0.78125rem;");
    expect(compact).toContain("--size-control: 2rem;");
    expect(compact).toContain("--space-row: 0.4375rem;");
  });

  it("sets an element's own text to its Density's body size, but never the root's, which the Text Size owns", () => {
    expect(block(css, "[data-density]:not(:root)")).toContain("font-size: var(--font-size-body);");
  });

  it("applies each text-size setting through a data attribute on the root element", () => {
    expect(css).toMatch(/html\[data-text-size="small"\]\s*\{\s*font-size: 16px;/);
    expect(css).toMatch(/html\[data-text-size="standard"\]\s*\{\s*font-size: 17px;/);
    expect(css).toMatch(/html\[data-text-size="large"\]\s*\{\s*font-size: 18px;/);
    expect(css).toMatch(/html\[data-text-size="xlarge"\]\s*\{\s*font-size: 20px;/);
  });

  it("sets body text in Inter, with the system stack as the fallback, in the body colour, never a grey", () => {
    expect(root).toMatch(/--font-sans: "Inter Variable", "Inter", ui-sans-serif, [^;]*sans-serif;/);
    expect(block(css, "body")).toContain("color: var(--color-text);");
    expect(block(css, "body")).toContain("font-family: var(--font-sans);");
  });

  it("writes numbers in tabular figures", () => {
    expect(css).toMatch(/table, time, data, \.num \{\s*font-variant-numeric: tabular-nums;/);
  });

  it("has motion tokens of 150 to 220ms, ease-out, and none under prefers-reduced-motion", () => {
    expect(root).toContain("--motion-fast: 150ms;");
    expect(root).toContain("--motion-slow: 220ms;");
    expect(root).toContain("--motion-easing: cubic-bezier(0.2, 0.8, 0.2, 1);");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block(reduced, ":root")).toContain("--motion-fast: 0ms;");
    expect(block(reduced, ":root")).toContain("--motion-slow: 0ms;");
  });

  it("draws thin scrollbars, transparent at rest, shown only while their area scrolls", () => {
    expect(block(css, "*")).toContain("scrollbar-width: thin;");
    expect(block(css, "*")).toContain("scrollbar-color: transparent transparent;");
    expect(block(css, ".is-scrolling")).toContain("scrollbar-color: var(--color-border-strong) transparent;");
  });

  it("stays on the ADR-0009 floor itself", () => {
    expect(auditStylesheet(css)).toEqual([]);
  });
});
