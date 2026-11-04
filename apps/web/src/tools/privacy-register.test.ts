import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOSTS, TOOLS, type Tool } from "@jobhub/shared";

/**
 * The privacy register (`docs/privacy/register.md`, ADR-0064) stays hand-written, but it cannot forget a recipient:
 * every Tool that receives personal data, or queries drawn from it, and every Host has a line in its « Recipients and
 * their entries » table, naming entries the register has (#338).
 */
const REGISTER = readFileSync(new URL("../../../../docs/privacy/register.md", import.meta.url), "utf8");

/** The register's entries: its `## ` headings. */
const HEADINGS = [...REGISTER.matchAll(/^## (.+)$/gm)].map((match) => match[1]!.trim());

/** The « Recipients and their entries » table: each recipient's id and the entries it names. */
function recipientLines(register: string): Map<string, string[]> {
  const section = register.split(/^## /m).find((part) => part.startsWith("Recipients and their entries"));
  if (!section) return new Map();
  const lines = new Map<string, string[]>();
  for (const match of section.matchAll(/^\| `([a-z0-9-]+)` \| (.+?) \|$/gm)) lines.set(match[1]!, match[2]!.split(";").map((entry) => entry.trim()));
  return lines;
}

/** An entry named by its title, its references in brackets left out: « Coach Conversations » is « Coach Conversations (#124, #600) ». */
const hasEntry = (name: string) => HEADINGS.some((heading) => heading === name || heading.startsWith(`${name} (`));

describe("the privacy register (#338)", () => {
  const lines = recipientLines(REGISTER);

  it("has a line for every Tool that receives personal data, and for every Host", () => {
    const recipients = [...(TOOLS as readonly Tool[]).filter((tool) => tool.receivesPersonalData).map((tool) => tool.id), ...HOSTS.map((host) => host.id)];
    expect(recipients.filter((id) => !lines.has(id))).toEqual([]);
  });

  it("names no recipient the catalog does not have, nor a Tool that receives no personal data", () => {
    const known = new Set([...(TOOLS as readonly Tool[]).filter((tool) => tool.receivesPersonalData).map((tool) => tool.id), ...HOSTS.map((host) => host.id)]);
    expect([...lines.keys()].filter((id) => !known.has(id))).toEqual([]);
  });

  it("names, for each recipient, entries the register has", () => {
    const missing = [...lines].flatMap(([id, entries]) => entries.filter((entry) => !hasEntry(entry)).map((entry) => `${id}: ${entry}`));
    expect(missing).toEqual([]);
  });

  it("no longer says there is no transfer outside the EU, nor that the AI goes to EU endpoints only", () => {
    expect(REGISTER).not.toMatch(/no transfer outside the EU\./);
    expect(REGISTER).not.toMatch(/\| Processors \| The AI provider of the `coaching` task, EU endpoints only/);
  });

  it("fails on a Tool that receives personal data without its line", () => {
    const without = REGISTER.replace(/^\| `stripe` \|.*$/m, "");
    expect(recipientLines(without).has("stripe")).toBe(false);
    expect(recipientLines(REGISTER).has("stripe")).toBe(true);
  });
});
