import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Workflow runtime runs .claude/workflows/wf-dev.js as one self-contained script, so it cannot import a module.
// Its argument reader sits between two marker comments; this test evaluates that block on its own (#1090).
const source = readFileSync(".claude/workflows/wf-dev.js", "utf8");
const block = /\/\/ <parse-args>\n([\s\S]*?)\/\/ <\/parse-args>/.exec(source)?.[1];
if (!block) throw new Error("wf-dev.js: the // <parse-args> … // </parse-args> block is missing");

type Read = { issues: number[]; maxIssues: number; opts: Record<string, unknown> };
const parseArgs = new Function(`${block}\nreturn parseArgs`)() as (args: unknown) => Read;

describe("parseArgs — /wf-dev arguments (#1090)", () => {
  it("reads a single number, with or without #", () => {
    expect(parseArgs("1079")).toMatchObject({ issues: [1079], maxIssues: 1 });
    expect(parseArgs("#1079")).toMatchObject({ issues: [1079], maxIssues: 1 });
    expect(parseArgs("  #1079\n")).toMatchObject({ issues: [1079], maxIssues: 1 });
    expect(parseArgs(1079)).toMatchObject({ issues: [1079], maxIssues: 1 });
  });

  it("reads a list: the first number starts, the rest make the exact list, maxIssues is their count", () => {
    expect(parseArgs("1079 1080")).toMatchObject({ issues: [1079, 1080], maxIssues: 2 });
    expect(parseArgs("#1050, #1052")).toMatchObject({ issues: [1050, 1052], maxIssues: 2 });
    expect(parseArgs("#1050,#1052 , 1053")).toMatchObject({ issues: [1050, 1052, 1053], maxIssues: 3 });
    expect(parseArgs("1050 1050 1052")).toMatchObject({ issues: [1050, 1052], maxIssues: 2 });
  });

  it("reads a number followed by a paragraph, ignoring the numbers in the paragraph", () => {
    const message = "1079\n\nTu es lancé par l'orchestrateur. Lis l'ADR-0063 et la PR #1080, puis traite les 2 points du ticket.";
    expect(parseArgs(message)).toMatchObject({ issues: [1079], maxIssues: 1 });
    expect(parseArgs("#1079 : corrige l'en-tête, voir #1080.")).toMatchObject({ issues: [1079], maxIssues: 1 });
    expect(parseArgs("1050 1052\nconsignes : 3 étapes")).toMatchObject({ issues: [1050, 1052], maxIssues: 2 });
  });

  it("finds the first number after leading words", () => {
    expect(parseArgs("ticket #1079, merci")).toMatchObject({ issues: [1079], maxIssues: 1 });
  });

  it("fails with a clear error on a non-empty argument without a valid number, never falling back on the frontier", () => {
    expect(() => parseArgs("prends le ticket du coach")).toThrow(/no valid issue number/);
    expect(() => parseArgs("issue-1079 ADR-0063")).toThrow(/no valid issue number/);
    expect(() => parseArgs("#0")).toThrow(/no valid issue number/);
    expect(() => parseArgs("1079 0")).toThrow(/positive integer/);
    expect(() => parseArgs(Number.NaN)).toThrow(/positive integer/);
    expect(() => parseArgs(-3)).toThrow(/positive integer/);
    expect(() => parseArgs(12.5)).toThrow(/positive integer/);
    expect(() => parseArgs("prends le ticket du coach")).toThrow(/Accepted forms/);
  });

  it("refuses an object whose issue is not a positive integer", () => {
    for (const issue of ["1079 suivi de consignes", "abc", "", 0, -1, 10.5, Number.NaN, "#0", [1079], true]) {
      expect(() => parseArgs({ issue }), JSON.stringify(issue)).toThrow(/positive integer/);
    }
  });

  it("reads an object's issue and options", () => {
    expect(parseArgs({ issue: 1079, merge: false, maxParallel: 1 })).toEqual({
      issues: [1079],
      maxIssues: 1,
      opts: { issue: 1079, merge: false, maxParallel: 1 },
    });
    expect(parseArgs({ issue: "#1079" })).toMatchObject({ issues: [1079], maxIssues: 1 });
    expect(parseArgs({ issue: 1079, maxIssues: 3 })).toMatchObject({ issues: [1079], maxIssues: 3 });
  });

  it("keeps the frontier with no argument", () => {
    for (const args of [undefined, null, "", "   \n"]) {
      expect(parseArgs(args)).toEqual({ issues: [], maxIssues: 1000, opts: {} });
    }
    expect(parseArgs({ maxParallel: 3 })).toEqual({ issues: [], maxIssues: 1000, opts: { maxParallel: 3 } });
    expect(parseArgs({ maxIssues: 4 })).toMatchObject({ issues: [], maxIssues: 4 });
    const resume = [{ issue: 1048, from: "verify" }];
    expect(parseArgs({ resume })).toMatchObject({ issues: [], maxIssues: 1000, opts: { resume } });
  });

  it("is what the workflow uses, with no Number() reading of the issue left", () => {
    expect(source).toMatch(/= parseArgs\(args\)/);
    expect(source).not.toMatch(/Number\(String\(opts\.issue\)/);
  });
});
