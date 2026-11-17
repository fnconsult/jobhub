import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { portOffsetClashes, portOffsets } from "./port-offsets";

// Issue #1015: a spec that starts a server of its own puts it on E2E_WEB_PORT + an offset (e2e/support/ports.ts). Two specs
// asking for the same offset share the port: side by side on two workers, the second server fails on EADDRINUSE, or one
// spec talks to the other's server. enriched-contacts and database-connections both asked for 780.

const e2e = path.resolve(import.meta.dirname, "..");

/** Every spec of the suite, by its path under e2e/, with its source. */
function specs(dir = e2e): { file: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "support" || entry.name.startsWith("__") ? [] : specs(full);
    return entry.name.endsWith(".spec.ts") ? [{ file: path.relative(e2e, full), source: readFileSync(full, "utf8") }] : [];
  });
}

describe("the e2e specs' port offsets", () => {
  it("are each asked for by one spec only", () => {
    expect(portOffsetClashes(specs())).toEqual([]);
  });

  it("are read from every spec that starts a server of its own", () => {
    const read = specs().filter(({ source }) => portOffsets(source).length > 0).map(({ file }) => file);
    expect(read).toEqual(expect.arrayContaining(["enriched-contacts.spec.ts", "database-connections.spec.ts", "plan-prices.spec.ts", "coach-v2/human-coaches.spec.ts"]));
  });
});

describe("portOffsets", () => {
  it("reads a literal offset given to derivedPort or to a helper that starts a server", () => {
    const source = `
      const port = derivedPort(400);
      own = await startOwnServer(877, "coach_pages", {});
      server = await startServer(830, {}, "dev");
      server = await startSignInServer(209);
    `;
    expect(portOffsets(source)).toEqual([400, 877, 830, 209]);
  });

  it("reads an offset given through a constant", () => {
    const source = `
      const PORT_OFFSET = 605;
      server = await startOwnServer(PORT_OFFSET, "conversation_objects", {});
    `;
    expect(portOffsets(source)).toEqual([605]);
  });

  it("reads the offsets given to a spec's own helper, and through `offset` properties", () => {
    const source = `
      async function startConfiguredServer(offset: number, env: Record<string, string>) {
        const port = derivedPort(offset);
      }
      const off = [{ name: "a", offset: 700, env: {} }, { name: "b", offset: 720, env: {} }];
      for (const { offset, env } of off) await startConfiguredServer(offset, env);
      await startConfiguredServer(780, {});
    `;
    expect(portOffsets(source).sort()).toEqual([700, 720, 780]);
  });

  it("refuses an offset it cannot read, rather than missing a clash", () => {
    expect(() => portOffsets(`const port = derivedPort(base + 1);`)).toThrow(/base \+ 1/);
    expect(() => portOffsets(`await startOwnServer(UNKNOWN, "x", {});`)).toThrow(/UNKNOWN/);
  });

  it("finds nothing in a spec that starts no server", () => {
    expect(portOffsets(`test("x", async ({ page }) => { await page.goto("/"); });`)).toEqual([]);
  });
});

describe("portOffsetClashes", () => {
  it("names each offset two specs ask for, with the specs", () => {
    const clashes = portOffsetClashes([
      { file: "enriched-contacts.spec.ts", source: `await startConfiguredServer(780, {}); async function startConfiguredServer(offset: number) {}` },
      { file: "database-connections.spec.ts", source: `const port = derivedPort(780);` },
      { file: "plan-prices-dev.spec.ts", source: `server = await startServer(830, {}, "dev");` },
    ]);
    expect(clashes).toEqual([{ offset: 780, files: ["database-connections.spec.ts", "enriched-contacts.spec.ts"] }]);
  });

  it("lets one spec ask for the same offset twice: its tests run one after the other", () => {
    expect(portOffsetClashes([{ file: "root-env.spec.ts", source: `derivedPort(400); derivedPort(400);` }])).toEqual([]);
  });
});
