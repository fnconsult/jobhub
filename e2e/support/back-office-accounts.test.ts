import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// signInWithMagicLink forgets the account's Two-step verification, counts the emails already sent to it, asks for a
// link and opens the next one. Two specs signing the same account in on parallel workers both count the same emails,
// open the same single-use link, and one of them never reaches /compte (plans.spec failed so beside billing.spec,
// both signed in as back-office@): so each spec signs in a Back Office account of its own.

const e2e = join(__dirname, "..");
const specs = readdirSync(e2e).filter((name) => name.endsWith(".spec.ts"));
/** The e2e Back Office addresses a spec signs in: a constant it names, or a literal handed to signInWithMagicLink. */
const signedIn = (source: string) =>
  new Set([...source.matchAll(/(?:const\s+\w+\s*=\s*|signInWithMagicLink\(\s*\w+\s*,\s*)"([a-z0-9.-]+@e2e\.jobbbox\.test)"/g)].map((match) => match[1]!));

describe("the e2e suite's Back Office accounts", () => {
  it("are each signed in by one spec only, so parallel workers never share a magic link", () => {
    const specsOf = new Map<string, string[]>();
    for (const spec of specs) for (const address of signedIn(readFileSync(join(e2e, spec), "utf8"))) specsOf.set(address, [...(specsOf.get(address) ?? []), spec]);
    expect([...specsOf].filter(([, by]) => by.length > 1)).toEqual([]);
  });
});
