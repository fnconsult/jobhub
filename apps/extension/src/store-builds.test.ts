// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "wxt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ICON_SIZES, isExtensionVersion } from "./build-target";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const packageVersion: string = JSON.parse(readFileSync(path.join(extensionRoot, "package.json"), "utf8")).version;

interface Built {
  manifest: Record<string, unknown> & { host_permissions: string[]; icons: Record<string, string>; version: string; name: string };
  /** Every script the build bundles, joined: where the web app's origin is compiled in. */
  code: string;
  dir: string;
}

const outBase = mkdtempSync(path.join(tmpdir(), "jobbbox-extension-"));

/** Builds the extension in a WXT mode, as `wxt build --mode <mode>` would, a stray WXT_WEB_ORIGIN set. */
async function buildIn(mode: string): Promise<Built> {
  const saved = process.env.WXT_WEB_ORIGIN;
  process.env.WXT_WEB_ORIGIN = "https://elsewhere.example";
  try {
    await build({ root: extensionRoot, mode, outDir: path.join(outBase, mode) });
  } finally {
    if (saved === undefined) delete process.env.WXT_WEB_ORIGIN;
    else process.env.WXT_WEB_ORIGIN = saved;
  }
  const dir = path.join(outBase, mode, mode === "production" ? "chrome-mv3" : `chrome-mv3-${mode}`);
  const scripts = (readdirSync(dir, { recursive: true }) as string[]).filter((file) => file.endsWith(".js"));
  return {
    dir,
    manifest: JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")),
    code: scripts.map((file) => readFileSync(path.join(dir, file), "utf8")).join("\n"),
  };
}

// The two builds of one Extension Version, each on its own Chrome Web Store listing (#563, ADR-0063).
describe("the extension's store builds", () => {
  let publicBuild: Built;
  let betaBuild: Built;

  beforeAll(async () => {
    publicBuild = await buildIn("production");
    betaBuild = await buildIn("beta");
  }, 120_000);

  afterAll(() => rmSync(outBase, { recursive: true, force: true }));

  it("the public build calls Production, jobbbox.ai, whatever WXT_WEB_ORIGIN says", () => {
    expect(publicBuild.manifest.host_permissions[0]).toBe("https://jobbbox.ai/*");
    expect(publicBuild.code).toMatch(/[`'"]https:\/\/jobbbox\.ai[`'"]/);
    expect(publicBuild.code).not.toContain("staging.jobbbox.ai");
    expect(publicBuild.code).not.toContain("elsewhere.example");
    expect(publicBuild.code).not.toContain("localhost:3000");
  });

  it("the beta build calls the Beta, staging.jobbbox.ai, whatever WXT_WEB_ORIGIN says", () => {
    expect(betaBuild.manifest.host_permissions[0]).toBe("https://staging.jobbbox.ai/*");
    expect(betaBuild.code).toMatch(/[`'"]https:\/\/staging\.jobbbox\.ai[`'"]/);
    expect(betaBuild.code).not.toContain("//jobbbox.ai");
    expect(betaBuild.code).not.toContain("elsewhere.example");
    expect(betaBuild.code).not.toContain("localhost:3000");
    expect(JSON.stringify(betaBuild.manifest)).not.toContain("//jobbbox.ai");
  });

  it("both carry the Extension Version, digits only, from package.json", () => {
    expect(isExtensionVersion(packageVersion)).toBe(true);
    for (const { manifest } of [publicBuild, betaBuild]) {
      expect(manifest.version).toBe(packageVersion);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest).not.toHaveProperty("version_name");
    }
  });

  it("the beta build is named « Jobbbox (bêta) » and has its own icon", () => {
    expect(publicBuild.manifest.name).toBe("__MSG_extName__");
    expect(betaBuild.manifest.name).toBe("__MSG_extNameBeta__");
    const fr = JSON.parse(readFileSync(path.join(betaBuild.dir, "_locales/fr/messages.json"), "utf8"));
    const en = JSON.parse(readFileSync(path.join(betaBuild.dir, "_locales/en/messages.json"), "utf8"));
    expect([fr.extName.message, fr.extNameBeta.message, en.extNameBeta.message]).toEqual(["Jobbbox", "Jobbbox (bêta)", "Jobbbox (beta)"]);

    for (const [built, dir, other] of [[publicBuild, "icon", "icon-beta"], [betaBuild, "icon-beta", "icon"]] as const) {
      expect(Object.keys(built.manifest.icons)).toEqual(ICON_SIZES.map(String));
      for (const file of Object.values(built.manifest.icons)) {
        expect(file.startsWith(`${dir}/`)).toBe(true);
        expect(existsSync(path.join(built.dir, file))).toBe(true);
      }
      expect(existsSync(path.join(built.dir, other))).toBe(false);
    }
    expect(readFileSync(path.join(betaBuild.dir, "icon-beta/128.png"))).not.toEqual(readFileSync(path.join(publicBuild.dir, "icon/128.png")));
  });
});
