import { spawnSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import type { HarnessResult, Scenario } from "./support/coach-actions-harness";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #1158 (ADR-0119 « Questions about Jobbbox »): read_plan, and the human_coach Typed redirect. Driven through the public
// entry points: POST /api/coach (the Coach Panel's route) with the faked AI Coach calling the Coach Action a message names
// (`E2E_COACH_TOOL=<name>:<json>`, fake-mistral.mjs), the setting « Espace coach v2 » (ADR-0107) switched as the Back Office's
// Platform Settings switch it, and the AI Coach's Eval Cases played as an Eval Run plays them (support/coach-actions-harness.ts).
// Three acceptance criteria:
//  1. Eval Cases « combien de recherches me reste-t-il » gives read_plan;
//  2. Eval Cases « je veux parler à un vrai coach », the setting on then off;
//  3. Eval Cases « achète-moi une séance » is refused with a redirect.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const PORT_OFFSET = 1158;

let server: OwnServer;

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** « Espace coach v2 » as the Back Office's Platform Settings save it: the row, then the notification the server listens to. */
async function setCoachSpaceV2(on: boolean) {
  await query(
    `INSERT INTO platform_setting (name, value, updated_by_email) VALUES ('COACH_SPACE_V2', $1, 'e2e@jobbbox.ai')
     ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()`,
    [String(on)],
  );
  await query("SELECT pg_notify('platform_settings_changed', '')");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

async function newCandidate(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR" });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("coach-1158"));
  return page;
}

interface Asked {
  reply: string;
  redirect?: { page: string; section?: string | null; object?: string | null; href: string };
}

async function ask(page: Page, message: string, tools: [string, object][], say?: string): Promise<Asked> {
  const lines = [message, ...tools.map(([name, args]) => `E2E_COACH_TOOL=${name}:${JSON.stringify(args)}`), ...(say ? [`E2E_COACH_SAY_AFTER=${say}`] : [])];
  const asked = await page.request.post("/api/coach", { headers: { origin: server.origin }, data: { message: lines.join("\n") } });
  expect(asked.status(), await asked.text()).toBe(200);
  return (await asked.json()) as Asked;
}

function playEvalCases(evalCases: NonNullable<Scenario["evalCases"]>): HarnessResult["evals"] {
  const scenario: Scenario = { settings: { enabled: true, maxRounds: 2 }, shipped: true, replies: [], evalCases };
  const result = spawnSync(path.resolve("node_modules/.bin/tsx"), [path.resolve("e2e/support/coach-actions-harness.ts"), JSON.stringify(scenario)], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_NO_WARNINGS: "1" },
    encoding: "utf8",
    timeout: 90_000,
  });
  const line = result.stdout.split("\n").find((each) => each.startsWith("COACH_ACTIONS_RESULT "));
  if (!line) throw new Error(`Coach Actions harness failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  return (JSON.parse(line.slice("COACH_ACTIONS_RESULT ".length)) as HarnessResult).evals;
}

test.describe.configure({ mode: "serial" });

test.describe("the AI Coach, the Plan and the Human Coach (#1158)", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    server = await startOwnServer(PORT_OFFSET, "coach_plan_human_coach", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-plan-human-coach-e2e-coach-plan-huma",
      MAIL_TRANSPORT: "console",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_OFFER_EMAIL_READING_PROVIDER: "mistral",
      MISTRAL_API_KEY: "e2e-mistral-key",
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
      STRIPE_PRICE_STANDARD: "price_standard_monthly",
      STRIPE_PRICE_PREMIUM: "price_premium_monthly",
      STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
      STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
      STRIPE_API_URL: process.env.E2E_STRIPE_URL,
      COACH_ACTIONS_ENABLED: "true",
      NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("Eval Cases « combien de recherches me reste-t-il »: the case reads the Plan (plan:current), and read_plan is offered with its rule", () => {
    const [played] = playEvalCases([{ id: "plan-job-searches-left", scripted: "read_plan:{}" }]);
    expect(played!.offered).toContain("read_plan");
    expect(played!.system).toContain("read_plan");
  });

  test("« combien de recherches me reste-t-il », live: read_plan gives the Plan, the week's quotas used and left, and the reset Monday", async ({ browser }) => {
    const page = await newCandidate(browser);
    const asked = await ask(page, "Combien de recherches me reste-t-il cette semaine ?", [["read_plan", {}]]);
    expect(asked.reply).toContain("Offre du candidat :");
    expect(asked.reply).toContain("Quotas de la semaine, remis à zéro le lundi");
    expect(asked.reply).toMatch(/Recherches d'offres : \d+ utilisés? sur \d+, \d+ restants?/);
    expect(asked.reply).toContain("renvoi plan");
  });

  test("Eval Cases « je veux parler à un vrai coach », the setting on: the human_coach redirect, to the Human Coaches' page", () => {
    const [played] = playEvalCases([{ id: "human-coach-setting-on", scripted: 'redirect:{"target":"human_coach"}' }]);
    expect(played!.redirect).toMatchObject({ page: fr.coachRedirects.pages.humanCoaches, href: "/coachs" });
  });

  test("Eval Cases « je veux parler à un vrai coach », the setting off: no redirect, the AI Coach told to say it in one sentence", () => {
    const [played] = playEvalCases([{ id: "human-coach-setting-off", scripted: 'redirect:{"target":"human_coach"}' }]);
    expect(played!.redirect).toBeNull();
    expect(played!.toolResults.join("\n")).toContain("Le renvoi human_coach n'est pas disponible");
    expect(played!.toolResults.join("\n")).toContain("en une phrase");
  });

  test("« je veux parler à un vrai coach », live: « Espace coach v2 » on gives the redirect; switched off, one sentence and none", async ({ browser }) => {
    const page = await newCandidate(browser);
    const redirect = ['redirect', { target: "human_coach" }] as [string, object];

    await setCoachSpaceV2(true);
    const on = await ask(page, "Je veux parler à un vrai coach.", [redirect], "Je suis un coach IA ; vous choisissez un coach humain sous ma réponse.");
    expect(on.redirect).toMatchObject({ page: fr.coachRedirects.pages.humanCoaches, href: "/coachs" });

    await setCoachSpaceV2(false);
    const off = await ask(page, "Je veux parler à un vrai coach.", [redirect], "Je suis un coach IA ; Jobbbox ne propose pas encore de séance avec un coach humain.");
    expect(off.redirect).toBeUndefined();
    expect(off.reply).not.toContain("/coachs");
  });

  test("Eval Cases « achète-moi une séance »: refused with a redirect to where the Candidate books themselves; nothing proposed", () => {
    const [played] = playEvalCases([{ id: "human-coach-buy-session-refused", scripted: 'redirect:{"target":"human_coach"}' }]);
    expect(played!.proposals).toBe(0);
    expect(played!.redirect).toMatchObject({ page: fr.coachRedirects.pages.humanCoaches, href: "/coachs" });
    expect(played!.system).toMatch(/ne paie|n'achète|ne réserve/);
  });

  test("« achète-moi une séance », live: a refusal and the redirect, no order created", async ({ browser }) => {
    const page = await newCandidate(browser);
    await setCoachSpaceV2(true);
    const asked = await ask(page, "Achète-moi une séance avec un coach humain, avec ma carte enregistrée.", [["redirect", { target: "human_coach" }]], "Je ne peux pas acheter ni réserver : je ne paie jamais à votre place.");
    expect(asked.reply).toMatch(/ne peux pas/);
    expect(asked.redirect).toMatchObject({ href: "/coachs" });
    const orders = await query<{ count: string }>("SELECT count(*) FROM information_schema.tables WHERE table_name = 'coaching_session'");
    if (orders[0]!.count !== "0") expect(Number((await query<{ count: string }>("SELECT count(*) FROM coaching_session"))[0]!.count)).toBe(0);
  });
});
