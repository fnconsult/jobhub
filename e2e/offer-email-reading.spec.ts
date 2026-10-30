import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { HarnessCall, HarnessResult } from "./support/ai-harness";

// Issue #444 (ADR-0052): the Task Playbook « Lire un email d'offres d'emploi » and the EU-only
// offer_email_reading task. Public entry points: `@jobhub/coach-knowledge/tasks` (the seeds),
// `createAiLayerFromEnv()` (the AI layer, env-configured) and `emailIntakeHeldBack()` (what the
// Sources tab of Paramètres reads), each driven in a fresh process (see support/*-harness.ts).

const tsx = path.resolve("node_modules/.bin/tsx");
const run = (script: string, args: string[], env: Record<string, string>) =>
  spawnSync(tsx, [path.resolve("e2e/support", script), ...args], { env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env }, encoding: "utf8", timeout: 60_000 });
const resultOf = <T>(prefix: string, stdout: string, stderr: string): T => {
  const line = stdout.split("\n").find((l) => l.startsWith(`${prefix} `));
  if (!line) throw new Error(`harness failed:\n${stdout}\n${stderr}`);
  return JSON.parse(line.slice(prefix.length + 1)) as T;
};

test.describe("Task Playbook « Lire un email d'offres d'emploi »", () => {
  test("is the one more Playbook not validated at import, and its text passes taskInstructionsProblems", () => {
    const r = run("task-playbooks-harness.ts", [], {});
    const playbooks = resultOf<{ id: string; aiTask: string; validatedAtImport: boolean; problems: string[] }[]>("TP_RESULT", r.stdout, r.stderr);

    expect(playbooks.filter((p) => !p.validatedAtImport).map((p) => p.id)).toEqual(["job-offer-reading", "job-offer-email-reading"]);
    expect(playbooks.find((p) => p.id === "job-offer-email-reading")).toMatchObject({ aiTask: "offer_email_reading", problems: [] });
  });
});

test.describe("AI layer: offer_email_reading runs only on an EU endpoint", () => {
  const keys = { MISTRAL_API_KEY: "test-mistral-key", ANTHROPIC_API_KEY: "test-anthropic-key" };
  const call: HarnessCall = { kind: "generate", task: "offer_email_reading", candidateId: "cand-1", prompt: "Offre : DAF chez Acme, recrutée par Jeanne Martin" };
  const ai = (env: Record<string, string>) => {
    const r = run("ai-harness.ts", [JSON.stringify([call])], { ...keys, ...env });
    const usage = r.stdout.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.event === "ai_usage");
    return { ...resultOf<HarnessResult>("AI_HARNESS_RESULT", r.stdout, r.stderr), usage };
  };

  test("a route on Claude's direct API (outside the EU) is refused before anything is sent, even with EU AI Consent", () => {
    const r = ai({ AI_OFFER_EMAIL_READING_PROVIDER: "anthropic", ANTHROPIC_ENDPOINT: "direct", E2E_EU_AI_CONSENT: "cand-1" });

    expect(r.outcomes).toEqual([{ ok: false, error: expect.objectContaining({ name: "DataResidencyError" }) }]);
    expect(r.requests).toEqual([]);
    expect(r.usage).toEqual([expect.objectContaining({ task: "offer_email_reading", provider: "anthropic", outcome: "failed", reason: "data_residency", sent: false })]);
  });

  test("a route in the EU is served", () => {
    const r = ai({ AI_OFFER_EMAIL_READING_PROVIDER: "mistral" });

    expect(r.outcomes[0]).toMatchObject({ ok: true });
    expect(r.requests.map((req) => req.host)).toEqual(["api.eu.mistral.ai"]);
  });
});

test.describe("Email intake held back by its Task Playbook", () => {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://jobhub:jobhub@localhost:5433/jobhub";
  const held = (target: string) => {
    const r = run("offer-email-reading-harness.ts", [target], { ADMIN_DATABASE_URL: databaseUrl });
    return resultOf<{ before: string | null; after: string | null; label: string | null }>("OER_RESULT", r.stdout, r.stderr);
  };

  test("with JOBHUB_TARGET=production and no validated version, the source reads « en attente de validation »; a validation lifts it", () => {
    const r = held("production");

    expect(r.before).toBe("playbook_pending");
    expect(r.label).toBe("Indisponible : en attente de validation du playbook");
    expect(r.after).toBeNull();
  });

  test("on staging the latest version runs it, validated or not", () => {
    expect(held("staging").before).toBeNull();
  });
});
