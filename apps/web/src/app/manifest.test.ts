import { readFileSync } from "node:fs";
import { designTokens } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";
import { pendingSessionGate } from "@/two-step-verification/gate";
import { staysOpen } from "@/maintenance";
import manifest from "./manifest";

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(path: string): [number, number] {
  const png = readFileSync(path);
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("the web manifest (#988)", () => {
  const web = manifest();

  it("names Jobbbox and opens its home page", () => {
    expect(web.name).toBe("Jobbbox");
    expect(web.short_name).toBe("Jobbbox");
    expect(web.start_url).toBe("/");
    expect(web.display).toBe("standalone");
  });

  it("takes its colours from the Design System: the accent for the theme, the page's background", () => {
    expect(web.theme_color).toBe(designTokens.color.accent.light);
    expect(web.background_color).toBe(designTokens.color.background.light);
  });

  it("lists the logo at 192 and 512 px, and a maskable 512 px one, each file of its declared size", () => {
    const png = (web.icons ?? []).filter((icon) => icon.type === "image/png");
    expect(png.map(({ sizes, purpose }) => `${sizes} ${purpose}`).sort()).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const icon of png) {
      const [width, height] = pngSize(`apps/web/public${icon.src}`);
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  it("is reached by anyone, even mid sign-in or during maintenance, as its icons and the emails' logo are", () => {
    for (const path of ["/manifest.webmanifest", ...(web.icons ?? []).map((icon) => icon.src), "/brand/email-logo@2x.png", "/icon.svg", "/apple-icon.png"]) {
      expect(pendingSessionGate(path, "GET"), path).toBe("open");
    }
    expect(staysOpen("/brand/email-logo@2x.png")).toBe(true);
  });
});
