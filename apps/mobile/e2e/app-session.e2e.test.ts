// The app's session packaging (#685), checked against what the toolchain, the stores and the web host read:
// package versions, the server's plugins and trusted origins, and the app.json links the domain association files verify.
import { APP_IDENTIFIER, APP_ORIGIN, APP_SCHEME, APP_SIGN_IN_PATH } from "@jobhub/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8");
const json = (...path: string[]) => JSON.parse(read(...path)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const expo = json("apps", "mobile", "app.json").expo;
const mobile = json("apps", "mobile", "package.json");
const web = json("apps", "web", "package.json");
const installed = (workspace: string, name: string) => json("apps", workspace, "node_modules", name, "package.json").version as string;
const authServer = read("apps", "web", "src", "auth", "index.ts");

describe("Better Auth's Expo packages (#685)", () => {
  it("are installed on both sides, aligned on better-auth", () => {
    expect(web.dependencies["@better-auth/expo"]).toBeDefined();
    expect(mobile.dependencies["@better-auth/expo"]).toBeDefined();
    expect(mobile.dependencies["expo-secure-store"]).toBeDefined();
    expect(mobile.dependencies["better-auth"]).toBe(web.dependencies["better-auth"]);
    expect(mobile.dependencies["@better-auth/expo"]).toBe(web.dependencies["@better-auth/expo"]);
    for (const workspace of ["web", "mobile"]) {
      expect(installed(workspace, "@better-auth/expo")).toBe(installed(workspace, "better-auth"));
    }
    expect(installed("mobile", "better-auth")).toBe(installed("web", "better-auth"));
  });

  it("add no bearer plugin and no jwt plugin, on the server or in the app", () => {
    for (const source of [authServer, read("apps", "mobile", "src", "session", "app-session.ts")]) {
      expect(source).not.toMatch(/\bbearer\s*\(/);
      expect(source).not.toMatch(/\bjwt\s*\(/);
      expect(source).not.toMatch(/better-auth\/plugins\/(bearer|jwt)/);
    }
    expect(authServer).toMatch(/\bexpo\(\)/);
  });
});

describe("Trusted origins (#685)", () => {
  it("add the app's scheme and nothing else for the app", () => {
    expect(APP_ORIGIN).toBe(`${expo.scheme}://`);
    expect(APP_SCHEME).toBe(expo.scheme);
    const line = authServer.split("\n").find((l) => l.includes("trustedOrigins:"))!;
    expect(line).toContain("APP_ORIGIN");
    expect(line).not.toMatch(/exp:\/\/|\*/);
  });
});

describe("Universal links and App Links (#685)", () => {
  const hosts = ["jobbbox.ai", "staging.jobbbox.ai"];

  it("open the app from the magic link's address on iOS, for the production and the Beta hosts", () => {
    expect(expo.ios.associatedDomains.sort()).toEqual(hosts.map((host) => `applinks:${host}`).sort());
    expect(expo.ios.bundleIdentifier).toBe(APP_IDENTIFIER);
  });

  it("open the app from the same address on Android, verified, for the same hosts", () => {
    expect(expo.android.package).toBe(APP_IDENTIFIER);
    const filter = expo.android.intentFilters.find((f: any) => f.autoVerify); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(filter.action).toBe("VIEW");
    expect(filter.category).toEqual(expect.arrayContaining(["BROWSABLE", "DEFAULT"]));
    expect(filter.data.map((d: any) => [d.scheme, d.host, d.pathPrefix]).sort()).toEqual( // eslint-disable-line @typescript-eslint/no-explicit-any
      hosts.map((host) => ["https", host, APP_SIGN_IN_PATH]).sort(),
    );
  });

  it("are backed by the web host: both association files and the browser fallback exist", () => {
    for (const route of [
      ["apps", "web", "src", "app", ".well-known", "apple-app-site-association", "route.ts"],
      ["apps", "web", "src", "app", ".well-known", "assetlinks.json", "route.ts"],
      ["apps", "web", "src", "app", ...APP_SIGN_IN_PATH.split("/").filter(Boolean), "route.ts"],
    ]) {
      expect(read(...route).length).toBeGreaterThan(0);
    }
  });
});
