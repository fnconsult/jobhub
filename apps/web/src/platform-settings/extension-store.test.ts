import { describe, expect, it } from "vitest";
import { extensionStorePage } from "./extension-store";
import { snapshotOfSettings } from "./resolver";

const PAGE = "https://chromewebstore.google.com/detail/jobbbox/abcdefghijklmnopabcdefghijklmnop";
const setBy = { updatedBy: "ops@jobbbox.ai", updatedAt: new Date("2026-10-22T10:00:00Z") };

describe("the extension's store page Mon compte offers (#303)", () => {
  it("is none, « coming soon », while nothing sets it", () => {
    expect(extensionStorePage(snapshotOfSettings({}, {}))).toBeNull();
  });

  it("is the Back Office's, over env's", () => {
    expect(extensionStorePage(snapshotOfSettings({ EXTENSION_STORE_URL: "https://example.test/old" }, { EXTENSION_STORE_URL: { value: PAGE, ...setBy } }))).toBe(PAGE);
  });

  it("is env's when the Back Office holds none", () => {
    expect(extensionStorePage(snapshotOfSettings({ EXTENSION_STORE_URL: ` ${PAGE} ` }, {}))).toBe(PAGE);
  });

  it("is none when env's is not an https URL: never a link over plain http", () => {
    expect(extensionStorePage(snapshotOfSettings({ EXTENSION_STORE_URL: "http://chromewebstore.google.com/detail/jobbbox" }, {}))).toBeNull();
  });
});
