import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Issue #131: the Coach eval suite. Its public entry point is the CLI `npm run coach:eval`;
// these tests run it offline (AI_FAKE=true, no API calls) and check the committed results,
// the CI workflow and the default model decision.

const evalsDir = path.resolve("docs/research/coach-evals");
const tsx = path.resolve("node_modules/.bin/tsx");
const harness = path.resolve("e2e/support/coach-model-harness.ts");

function runEval(args: string[], env: Record<string, string> = { AI_FAKE: "true" }) {
  const result = spawnSync("npm", ["run", "--silent", "coach:eval", "--", ...args], {
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, AWS_BEARER_TOKEN_BEDROCK: "", ANTHROPIC_API_KEY: "", AI_FAKE: "", ...env },
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function coachModel(env: Record<string, string>): string {
  const result = spawnSync(tsx, [harness, JSON.stringify(env)], { encoding: "utf8", timeout: 60_000 });
  const line = result.stdout.split("\n").find((l) => l.startsWith("CM_RESULT "));
  if (!line) throw new Error(`harness failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  return (JSON.parse(line.slice("CM_RESULT ".length)) as { model: string }).model;
}

test.describe("suite runs from one command", () => {
  test("npm run coach:eval runs every case on both models and writes a Markdown and a JSON report", () => {
    const out = mkdtempSync(path.join(tmpdir(), "coach-evals-e2e-"));
    const { status, output } = runEval(["--out", out]);
    expect(status, output).toBe(0);
    expect(output).toContain("19 cases × claude-opus-5-5, claude-sonnet-5-5");
    expect(output).toMatch(/claude-sonnet-5-5: \d+\/19 passed/);
    expect(output).toContain("Recommended default:");

    const files = readdirSync(out).sort();
    expect(files).toHaveLength(2);
    expect(files.map((f) => path.extname(f))).toEqual([".json", ".md"]);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.json$/);

    const json = JSON.parse(readFileSync(path.join(out, files[0]!), "utf8")) as {
      setVersion: string;
      judgeModel: string;
      models: { model: string; results: { caseId: string }[] }[];
    };
    expect(json.setVersion).toBe("coach-v1");
    expect(json.judgeModel).toBe("claude-opus-5-5");
    expect(json.models.map((m) => m.model)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    for (const model of json.models) expect(model.results).toHaveLength(19);
    expect(readFileSync(path.join(out, files[1]!), "utf8")).toMatch(/claude-sonnet-5-5/);
  });

  test("--models, --judge and --cases narrow the run", () => {
    const out = mkdtempSync(path.join(tmpdir(), "coach-evals-e2e-"));
    const { status, output } = runEval(["--models", "claude-sonnet-5-5", "--judge", "claude-sonnet-5-5", "--cases", "age-worry,statistic-trap", "--out", out]);
    expect(status, output).toBe(0);
    expect(output).toContain("2 cases × claude-sonnet-5-5; judge claude-sonnet-5-5");
    const json = JSON.parse(readFileSync(path.join(out, readdirSync(out).find((f) => f.endsWith(".json"))!), "utf8")) as {
      models: { results: { caseId: string }[] }[];
    };
    expect(json.models).toHaveLength(1);
    expect(json.models[0]!.results.map((r) => r.caseId).sort()).toEqual(["age-worry", "statistic-trap"]);
  });

  test("an unknown case id exits 2 and writes nothing", () => {
    const out = mkdtempSync(path.join(tmpdir(), "coach-evals-e2e-"));
    const { status, output } = runEval(["--cases", "no-such-case", "--out", out]);
    expect(status).toBe(2);
    expect(output).toContain("Unknown cases: no-such-case");
    expect(readdirSync(out)).toEqual([]);
  });

  test("without Claude credentials it fails and writes nothing", () => {
    const out = mkdtempSync(path.join(tmpdir(), "coach-evals-e2e-"));
    const { status } = runEval(["--cases", "age-worry", "--out", out], {});
    expect(status).not.toBe(0);
    expect(readdirSync(out)).toEqual([]);
  });
});

test.describe("results committed under docs/research/coach-evals", () => {
  test("the folder documents how to run the suite and holds the cost projection behind the decision", () => {
    expect(existsSync(evalsDir)).toBe(true);
    const files = readdirSync(evalsDir);
    expect(files).toContain("README.md");
    expect(files.some((f) => /^\d{4}-\d{2}-\d{2}-cost-projection\.md$/.test(f))).toBe(true);
    expect(readFileSync(path.join(evalsDir, "README.md"), "utf8")).toContain("npm run coach:eval");
  });

  test("a nightly and pull-request workflow runs the suite and keeps its reports", () => {
    const workflow = readFileSync(path.resolve(".github/workflows/coach-evals.yml"), "utf8");
    expect(workflow).toMatch(/schedule:/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toContain("npm run coach:eval");
    expect(workflow).toContain("upload-artifact");
  });
});

test.describe("default model decided", () => {
  test("the decision is recorded and the AI Coach runs on Claude Sonnet 5.5 by default", () => {
    expect(readFileSync(path.join(evalsDir, "README.md"), "utf8")).toMatch(/default model is Claude Sonnet 5\.5/);
    expect(coachModel({ AI_COACHING_PROVIDER: "anthropic", ANTHROPIC_ENDPOINT: "bedrock", AWS_BEARER_TOKEN_BEDROCK: "t" })).toBe("anthropic.claude-sonnet-5-5");
  });

  test("AI_COACHING_MODEL overrides the default", () => {
    expect(coachModel({ AI_COACHING_PROVIDER: "anthropic", AWS_BEARER_TOKEN_BEDROCK: "t", AI_COACHING_MODEL: "anthropic.claude-opus-5-5" })).toBe("anthropic.claude-opus-5-5");
  });
});
