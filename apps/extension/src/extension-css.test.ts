import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditStylesheet } from "@jobhub/shared/design";

// The extension's own stylesheets, beside the shared design tokens: held to the ADR-0009 floor of the
// Confort Density, which the extension keeps (ADR-0054), like the web app's app.css.
const entrypoints = new URL("../entrypoints/", import.meta.url);
const stylesheets = readdirSync(entrypoints, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".css"));

describe("the extension's stylesheets", () => {
  it("are found", () => {
    expect(stylesheets).toEqual(expect.arrayContaining(["popup/popup.css", "analyse/analyse.css"]));
  });

  it.each(stylesheets)("%s stays on the ADR-0009 floor: no type below 16px, text only in audited text colours, colours only as tokens", (path) => {
    expect(auditStylesheet(readFileSync(new URL(path, entrypoints), "utf8"))).toEqual([]);
  });

  it("would flag a stylesheet off the floor, so the check bites", () => {
    expect(auditStylesheet(".x { font-size: 12px; color: #999; }")).not.toEqual([]);
  });
});
