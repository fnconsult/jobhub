import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Jobbbox's server never reads LinkedIn (ADR-0001, ADR-0119 « LinkedIn, through the extension only », #1164): the code that
 * keeps and reads what the extension read of a LinkedIn page reaches no network at all, so no request of the server can go
 * to linkedin.com. The modules' own tests spy on fetch while they run; this one keeps any network client out of them.
 */
const SERVER_CODE = [
  "apps/web/src/linkedin-readings",
  "apps/web/src/app/api/linkedin-readings",
  "apps/web/src/coach-actions/linkedin-reading.ts",
  "packages/shared/src/linkedin-reading.ts",
];
const ROOT = path.resolve(__dirname, "../../../..");

function sources(entry: string): string[] {
  const at = path.join(ROOT, entry);
  if (!statSync(at).isDirectory()) return [at];
  return readdirSync(at).flatMap((name) => sources(path.join(entry, name)));
}

/** A network client: fetch, an HTTP module, a socket, or a library that makes requests. */
const NETWORK = /\bfetch\s*\(|from\s+["'](node:)?(https?|http2|net|tls|undici|axios|got|node-fetch)["']|require\(["'](node:)?(https?|net)["']\)|XMLHttpRequest|WebSocket/;

describe("no request of Jobbbox's server reaches linkedin.com (ADR-0119, #1164)", () => {
  const code = SERVER_CODE.flatMap(sources).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

  it("covers the server code of LinkedIn Readings", () => {
    expect(code.map((file) => path.relative(ROOT, file)).sort()).toEqual([
      "apps/web/src/app/api/linkedin-readings/route.ts",
      "apps/web/src/coach-actions/linkedin-reading.ts",
      "apps/web/src/linkedin-readings/index.ts",
      "apps/web/src/linkedin-readings/server.ts",
      "packages/shared/src/linkedin-reading.ts",
    ]);
  });

  it.each(SERVER_CODE)("%s calls no network: it keeps and reads what the extension sent", (entry) => {
    for (const file of sources(entry).filter((each) => code.includes(each))) {
      expect(readFileSync(file, "utf8"), path.relative(ROOT, file)).not.toMatch(NETWORK);
    }
  });
});
