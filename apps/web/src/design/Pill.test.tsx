// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Pill } from "./Pill";

const css = () => readFileSync("apps/web/src/design/Pill.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ruleOf = (selector: string) => new RegExp(`${selector.replace(/[.[\]"=$]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css())?.[1] ?? "";

describe("the Pill (#462) and its small size (ADR-0009, amendment of 2026-11-12)", () => {
  it("is at body size by default, its size unset", () => {
    render(<Pill tone="accent">À traiter</Pill>);
    const pill = screen.getByText("À traiter");
    expect(pill.className).toBe("ds-pill");
    expect(pill.dataset.size).toBeUndefined();
    expect(ruleOf(".ds-pill")).toMatch(/font-size:\s*var\(--font-size-body\)/);
  });

  it("takes the metadata size with size=\"sm\", in a token so it follows the Density and the Text Size", () => {
    render(<Pill size="sm">hors UE</Pill>);
    const pill = screen.getByText("hors UE");
    expect(pill.dataset.size).toBe("sm");
    expect(pill.dataset.tone).toBe("neutral");
    const rule = ruleOf('.ds-pill[data-size="sm"]');
    expect(rule).toMatch(/font-size:\s*var\(--font-size-meta\)/);
    expect(rule).toMatch(/padding:\s*0 var\(--space-1\)/);
  });
});
