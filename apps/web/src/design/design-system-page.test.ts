import { describe, expect, it } from "vitest";
import { designTokens } from "@jobhub/shared/design";
import { designSystemHref, designSystemView, tokenCatalogue } from "./design-system-page";

describe("the Design System page's tokens (#463)", () => {
  const catalogue = tokenCatalogue(designTokens);

  it("lists every colour token, in the tokens' order, with its CSS variable and its light and dark values", () => {
    expect(catalogue.colors).toHaveLength(27);
    expect(catalogue.colors[0]).toEqual({ token: "background", variable: "--color-background", light: "#ffffff", dark: "#121219" });
    expect(catalogue.colors).toContainEqual({ token: "text", variable: "--color-text", light: "#1b1b26", dark: "#ececf3" });
    expect(catalogue.colors).toContainEqual({ token: "borderStrong", variable: "--color-border-strong", light: "#d6d6de", dark: "#383846" });
    expect(catalogue.colors).toContainEqual({ token: "chart1", variable: "--color-chart-1", light: "#6a78ee", dark: "#8d9bff" });
    expect(catalogue.colors.at(-1)).toEqual({ token: "scrim", variable: "--color-scrim", light: "rgb(20 20 40 / 28%)", dark: "rgb(0 0 0 / 50%)" });
  });

  it("gives the type scale, largest first, in px for each Density, with the variable that sets it", () => {
    expect(catalogue.typeScale).toEqual([
      { style: "h1", variable: "--font-size-h1", confort: 32, compact: 24 },
      { style: "h2", variable: "--font-size-h2", confort: 24, compact: 18 },
      { style: "h3", variable: "--font-size-h3", confort: 20, compact: 16 },
      { style: "lead", variable: "--font-size-lead", confort: 18, compact: 15 },
      { style: "body", variable: "--font-size-body", confort: 16, compact: 14 },
      { style: "meta", variable: "--font-size-meta", confort: 13, compact: 12.5 },
    ]);
  });
});

describe("the Design System page's theme and Density (#463)", () => {
  it("shows the light theme in Confort unless its address asks otherwise", () => {
    expect(designSystemView({})).toEqual({ theme: "light", density: "confort" });
    expect(designSystemView({ theme: "sombre", densite: "compact" })).toEqual({ theme: "dark", density: "compact" });
    expect(designSystemView({ theme: "nuit", densite: "serré" })).toEqual({ theme: "light", density: "confort" });
    expect(designSystemView({ theme: ["sombre", "clair"] })).toEqual({ theme: "dark", density: "confort" });
  });

  it("puts in its address only what differs from the light theme in Confort, so a reload shows the same", () => {
    expect(designSystemHref({ theme: "light", density: "confort" })).toBe("/admin/design-system");
    expect(designSystemHref({ theme: "dark", density: "confort" })).toBe("/admin/design-system?theme=sombre");
    expect(designSystemHref({ theme: "light", density: "compact" })).toBe("/admin/design-system?densite=compact");
    expect(designSystemHref({ theme: "dark", density: "compact" })).toBe("/admin/design-system?theme=sombre&densite=compact");
    expect(designSystemView(Object.fromEntries(new URL(designSystemHref({ theme: "dark", density: "compact" }), "http://x").searchParams))).toEqual({
      theme: "dark",
      density: "compact",
    });
  });
});
