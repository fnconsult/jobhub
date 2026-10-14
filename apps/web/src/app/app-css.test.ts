import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditStylesheet } from "@jobhub/shared/design";

// The web app's one stylesheet (ADR-0018), held to the ADR-0009 floor like the prototype it follows (#132).
const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

describe("the web app's stylesheet", () => {
  it("stays on the ADR-0009 floor: no type below 16px, text only in audited text colours, colours only as tokens", () => {
    expect(auditStylesheet(css)).toEqual([]);
  });
});
