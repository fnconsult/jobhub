import { readFileSync } from "node:fs";
import { auditStylesheet } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";

// The web app's one stylesheet, held to the ADR-0009 floor like the prototype it follows (#132):
// no type below 16px, text only in the audited text colours, colours only as named tokens.
const appCss = readFileSync(new URL("../app/app.css", import.meta.url), "utf8");

describe("the web app's stylesheet", () => {
  it("stays on the ADR-0009 floor", () => {
    expect(auditStylesheet(appCss)).toEqual([]);
  });
});
