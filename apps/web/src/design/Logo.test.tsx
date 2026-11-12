// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./Logo";

describe("the logo's symbol (ADR-0105)", () => {
  it("is decorative: the name beside it says « Jobbbox »", () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector("svg.ds-logo")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector("title")).toBeNull();
  });

  it("stays still unless asked to move", () => {
    expect(render(<Logo />).container.querySelector("svg")!.hasAttribute("data-animated")).toBe(false);
    expect(render(<Logo animated />).container.querySelector("svg")!.hasAttribute("data-animated")).toBe(true);
  });

  it("draws the three dots of the coach answering, and keeps two symbols on a page apart", () => {
    const { container } = render(
      <>
        <Logo />
        <Logo />
      </>,
    );
    expect(container.querySelectorAll(".ds-logo__dot")).toHaveLength(6);
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("moves only when asked and when motion is welcome, each part resting in its own style", () => {
    const css = readFileSync("apps/web/src/design/Logo.css", "utf8");
    const welcome = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n {2}\}\n/.exec(css)![1]!;
    expect(css.replace(welcome, "")).not.toMatch(/^\s*animation:/m);
    for (const rule of welcome.matchAll(/([^{}]+)\{[^}]*animation:[^}]*\}/g)) expect(rule[1]).toContain(".ds-logo[data-animated]");
    for (const animation of welcome.matchAll(/animation:\s*([^;]+);/g)) expect(animation[1]).toMatch(/\bboth\b/);
  });
});
