import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { edgePage, edgePageFiles } from "./pages";

const dir = path.resolve(__dirname, "../../../../deploy/edge/pages");

describe("the proxy's fallback error pages (ADR-0094)", () => {
  it("are committed as generated: run `npm run edge-pages -w @jobhub/web` after changing them", () => {
    const files = edgePageFiles();
    expect(readdirSync(dir).sort()).toEqual(Object.keys(files).sort());
    for (const [name, html] of Object.entries(files)) expect(readFileSync(path.join(dir, name), "utf8"), name).toBe(html);
  });

  it("show the code and both languages, the asked one first, and reload themselves", () => {
    const fr = edgePage(503, "fr");
    expect(fr).toContain('<html lang="fr">');
    expect(fr).toContain('<p class="code" aria-hidden="true">503</p>');
    expect(fr.indexOf("Jobbbox revient dans un instant</h1>")).toBeLessThan(fr.indexOf("Jobbbox will be back in a moment</h1>"));
    expect(fr).toContain('<meta http-equiv="refresh" content="15">');
    const en = edgePage(502, "en");
    expect(en).toContain('<html lang="en">');
    expect(en.indexOf("Jobbbox will be back in a moment</h1>")).toBeLessThan(en.indexOf("Jobbbox revient dans un instant</h1>"));
    expect(en).toContain(">Try again · Réessayer</a>");
  });

  it("load nothing: no script, stylesheet, image or font file", () => {
    for (const html of Object.values(edgePageFiles())) expect(html).not.toMatch(/<script|<link|<img|src=|url\(/);
  });
});
