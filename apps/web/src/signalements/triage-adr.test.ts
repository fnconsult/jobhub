import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DRAFT_STATE_KEYS,
  PROPOSED_DRAFT_KEYS,
  SEEN_KEYS,
  TRIAGE_KEYS,
} from "./triage";
import { REMOVAL_REASONS, TRIAGE_MISSING_REASONS } from "./values";

/**
 * ADR-0118 stays hand-written, but its fixed keys cannot drift from the code again (#1173): the dated amendment that
 * changed them names every key triage answers, the minimal answers of its writes, the 409 and each reason of a 404.
 */
const ADR_DIR = new URL("../../../../docs/adr/", import.meta.url);
const ADR = readFileSync(
  new URL(
    readdirSync(ADR_DIR).find((file) => file.startsWith("0118-"))!,
    ADR_DIR,
  ),
  "utf8",
);

/** The amendment of #1173: its `## Amendment: … (issue #1173, <date>)` section, up to the next `## `. */
function amendment(adr: string): string | null {
  const start = adr.search(
    /^## Amendment: .*\(issue #1173, \d{4}-\d{2}-\d{2}\)$/m,
  );
  if (start < 0) return null;
  const rest = adr.slice(start + 3);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** The keys `text` does not name in code (`issue`, or `{ id, statut }`): each a whole word inside a code span. */
const named = (text: string, keys: readonly string[]) => {
  const code = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
  return keys.filter(
    (key) =>
      !code.some((span) => new RegExp(`(^|[^\\w])${key}($|[^\\w])`).test(span)),
  );
};

describe("ADR-0118's amendment for #1173", () => {
  const text = amendment(ADR) ?? "";

  it("is there, dated", () => {
    expect(amendment(ADR)).not.toBeNull();
  });

  it("names every key triage reads (TRIAGE_KEYS), with the issue linked and the draft's signature and date", () => {
    expect(named(text, TRIAGE_KEYS)).toEqual([]);
    expect(named(text, DRAFT_STATE_KEYS)).toEqual([]);
  });

  it("names the minimal answers of « vu » and of a draft (SEEN_KEYS, PROPOSED_DRAFT_KEYS)", () => {
    expect(named(text, SEEN_KEYS)).toEqual([]);
    expect(named(text, PROPOSED_DRAFT_KEYS)).toEqual([]);
  });

  it("names the 409 of an issue already linked, every reason of a 404 and the trace a removal leaves", () => {
    expect(
      named(text, [
        "already_linked",
        "commentOn",
        ...TRIAGE_MISSING_REASONS,
        ...REMOVAL_REASONS,
        "signalement_removed",
      ]),
    ).toEqual([]);
  });

  it("fails on an amendment that forgets a key", () => {
    expect(named(text.replaceAll("brouillon", "draft"), TRIAGE_KEYS)).toEqual([
      "brouillon",
    ]);
  });
});
