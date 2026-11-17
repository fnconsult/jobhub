// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICON_SIZES } from "./build-target";
import { extensionIcon, panelLogo } from "./panel-logo";

/** The extension's folder, from the repository root the tests run in (jsdom gives import.meta.url no file scheme). */
const root = "apps/extension/";

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(path: string): [number, number] {
  const png = readFileSync(path);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("the logo in the Side Panel's header (#988, ADR-0105)", () => {
  it("draws the symbol, decorative and still, then the name « Jobbbox », which stays its accessible name", () => {
    const logo = panelLogo(document, "Jobbbox");
    expect(logo.className).toBe("wordmark");
    expect(logo.textContent).toBe("Jobbbox");
    const symbol = logo.querySelector("svg")!;
    expect(symbol.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(symbol.getAttribute("aria-hidden")).toBe("true");
    expect(symbol.querySelectorAll("circle")).toHaveLength(3);
    expect(logo.querySelector("animate, animateTransform")).toBeNull();
  });

  it("keeps two drawings of the header apart", () => {
    const first = panelLogo(document, "Jobbbox");
    const second = panelLogo(document, "Jobbbox");
    const ids = [...first.querySelectorAll("[id]"), ...second.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the extension's icons (#988)", () => {
  it("draws the logo, flat at 16 and 32 px where the dots would not read, whole from 48 px", () => {
    expect(extensionIcon("icon", 16)).not.toContain("<circle");
    expect(extensionIcon("icon", 32)).not.toContain("<circle");
    expect(extensionIcon("icon", 48)).toContain("<circle");
    expect(extensionIcon("icon", 128)).toContain("<circle");
  });

  it("marks the beta's with an orange β, so the two builds side by side are never confused", () => {
    for (const size of ICON_SIZES) {
      expect(extensionIcon("icon-beta", size)).toContain("#c2410c");
      expect(extensionIcon("icon", size)).not.toContain("#c2410c");
    }
    expect(extensionIcon("icon-beta", 128)).toContain(">β<");
  });

  it.each(["icon", "icon-beta"])("%s: every size is drawn, at its size", (set) => {
    for (const size of ICON_SIZES) expect(pngSize(`${root}public/${set}/${size}.png`)).toEqual([size, size]);
  });

  it("gives the Chrome Web Store its 128 px icon, the artwork in 96 px with 16 px of transparent margin, and its small promo tile", () => {
    expect(pngSize(`${root}store/icon-128.png`)).toEqual([128, 128]);
    expect(pngSize(`${root}store/promo-tile-440x280.png`)).toEqual([440, 280]);
  });
});
