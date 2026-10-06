import { describe, expect, it } from "vitest";
import { designTokens, renderDesignCss } from "./index";

describe("renderDesignCss", () => {
  const css = renderDesignCss(designTokens);

  it("exposes colours as CSS custom properties", () => {
    expect(css).toContain("--color-text: #37352f;");
    expect(css).toContain("--color-surface: #f7f7f5;");
  });

  it("expresses type sizes in rem so the text-size setting scales them", () => {
    expect(css).toContain("--font-size-body: 1rem;");
    expect(css).toContain("--font-size-h1: 2rem;");
  });

  it("applies each text-size setting through a data attribute on the root element", () => {
    expect(css).toMatch(/html\[data-text-size="large"\]\s*\{\s*font-size: 18px;/);
    expect(css).toMatch(/html\[data-text-size="xlarge"\]\s*\{\s*font-size: 20px;/);
  });

  it("sets body text to the body colour, never a grey", () => {
    expect(css).toMatch(/body\s*\{[^}]*color: var\(--color-text\);/);
  });
});
