import { readdirSync, readFileSync } from "node:fs";
import { auditComponentStylesheet } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";

// Every stylesheet beside a Design System component (ADR-0053, #462).
const directory = new URL("./", import.meta.url);
const stylesheets = readdirSync(directory)
  .filter((name) => name.endsWith(".css"))
  .map((name) => ({ name, css: readFileSync(new URL(name, directory), "utf8") }));

describe("the Design System components' stylesheets (#462)", () => {
  it("are found", () => {
    expect(stylesheets.map((sheet) => sheet.name)).toContain("Button.css");
  });

  it.each(stylesheets)("$name takes every font size and colour from the tokens (audit)", ({ css }) => {
    expect(auditComponentStylesheet(css)).toEqual([]);
  });

  it.each(stylesheets)("$name states the layers' order, then holds its rules in the components layer", ({ css }) => {
    const source = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(source.startsWith("@layer base, components;")).toBe(true);
    const rest = source.slice("@layer base, components;".length).trim();
    expect(rest.startsWith("@layer components {")).toBe(true);
    expect(rest.endsWith("}")).toBe(true);
    expect(rest.indexOf("@layer", 1)).toBe(-1);
  });
});
