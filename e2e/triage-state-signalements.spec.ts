/**
 * #1173 (ADR-0118) — what Signalement triage is told when a Signalement is « traité », purged, or cannot be published,
 * end to end through the public entry points: the Agent API over HTTP (`Authorization: Bearer jbx_agent_…`), the Back
 * Office's « Clés d'agent » form in the browser, the real worker (`apps/worker`, nightly purge `signalements.purge`,
 * queued as its cron would) and the written procedure and processing register.
 * A server of its own (own database) with NO GITHUB_ISSUES_TOKEN: `…/issue` answers 503 `missing_token`.
 * The other criteria of #1173 (exact keys of both write answers, `issue` and `brouillon` in the queue, 409
 * `already_linked`, 404 `deleted`/`unknown`) are in agent-keys-signalements.spec.ts and issue-draft-signalements.spec.ts.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { PgBoss } from "pg-boss";
import { Pool } from "pg";
import { newAddress } from "./support/mailbox";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const keysText = fr.admin.agentKeys;
const SUPER_ADMIN = "triage-state-office@e2e.jobbbox.test";
const PORT_OFFSET = 1173;
const API = "/admin/api/signalements";
const SIGNALEMENTS_PURGE = "signalements.purge";
/** The keys of what the queue and `:id` render, in this order (apps/web/src/signalements/triage.ts, TRIAGE_KEYS). */
const EXPECTED_KEYS = ["id", "type", "message", "sentAt", "status", "environment", "version", "device", "interfaceLanguage", "textSize", "path", "attachedQuestion", "attachedCoachReply", "issue", "brouillon"];

let own: OwnServer;
let database: Pool;
let admin: Page;
let anonymous: APIRequestContext;
let key: string;

const tag = () => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });
const get = (path: string) => anonymous.get(`${own.origin}${path}`, { headers: bearer(key) });
const post = (path: string, data: unknown) => anonymous.post(`${own.origin}${path}`, { headers: bearer(key), data });
const ref = tag();
const candidate = { email: newAddress("triage-state-camille"), name: "Camille Durand-Lefèvre" };
const id = {} as Record<"treatedOld" | "treatedRecent" | "open" | "noNotice", string>;

const CLEAN = {
  title: "Écran vide après l'enregistrement d'une lettre de motivation",
  summary: "Enregistrer une lettre de motivation vide l'écran ; le texte saisi disparaît.",
  steps: "1. Ouvrir une candidature.\n2. Rédiger une lettre.\n3. Cliquer sur le bouton d'enregistrement.",
  expected: "La lettre est enregistrée et reste affichée.",
  environment: "Beta",
  version: "1.42.0 (main·35e2ea1)",
  device: "Chrome 141, Mac",
};

/** The real worker, on the spec's database. */
class Worker {
  output = "";
  private child: ChildProcess;
  constructor(databaseUrl: string) {
    this.child = spawn(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
      cwd: path.resolve("apps/worker"),
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DATABASE_URL: databaseUrl, APP_URL: own.origin, JOBHUB_IGNORE_ROOT_ENV: "1", MAIL_TRANSPORT: "console", JOBHUB_TARGET: "e2e" },
    });
    this.child.stdout!.on("data", (chunk: Buffer) => (this.output += chunk.toString()));
    this.child.stderr!.on("data", (chunk: Buffer) => (this.output += chunk.toString()));
  }
  async started() {
    await expect.poll(() => this.output, { timeout: 90_000, intervals: [500], message: `the worker starts (its output: ${this.output})` }).toMatch(/running \d+ job\(s\)/);
  }
  async stop() {
    if (this.child.exitCode !== null) return;
    const exited = new Promise((resolve) => this.child.once("exit", resolve));
    this.child.kill("SIGTERM");
    setTimeout(() => this.child.kill("SIGKILL"), 10_000).unref();
    await exited;
  }
}

/** Runs the nightly purge once, as its cron would, and waits until `done` holds. */
async function purge(done: () => Promise<boolean>) {
  const worker = new Worker(own.databaseUrl);
  try {
    await worker.started();
    const boss = new PgBoss({ connectionString: own.databaseUrl });
    boss.on("error", () => {});
    await boss.start();
    try {
      await boss.send(SIGNALEMENTS_PURGE, {});
    } finally {
      await boss.stop({ graceful: false });
    }
    await expect.poll(done, { timeout: 60_000, intervals: [500], message: `the purge ran (worker output: ${worker.output})` }).toBe(true);
  } finally {
    await worker.stop();
  }
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  await signInByEmail(page, own, email);
  return page;
}

test.beforeAll(async ({ browser }) => {
  own = await startOwnServer(PORT_OFFSET, "triage_state", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    ADMIN_EMAILS: SUPER_ADMIN,
    AUTH_SECRET: "triage-state-e2e-secret-triage-state-e2e-secret",
    MAIL_TRANSPORT: "console",
    GITHUB_ISSUES_TOKEN: "",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
    STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
  });
  database = new Pool({ connectionString: own.databaseUrl });
  anonymous = await playwrightRequest.newContext();
  admin = await signedIn(browser, SUPER_ADMIN);
});

test.afterAll(async () => {
  try {
    await anonymous?.dispose();
    await admin?.context().close();
  } finally {
    await database?.end();
    await own?.stop();
  }
});

test.describe.configure({ mode: "serial" });

test("setup: an Agent Key and four Signalements, one sent without the AI notice", async ({ browser }) => {
  test.setTimeout(240_000);
  await admin.goto("/admin/parametres?tab=cles-agent");
  await admin.getByLabel(keysText.create.name).fill("triage-state");
  await admin.getByLabel(keysText.create.days).fill("90");
  await admin.getByRole("button", { name: keysText.create.submit }).click();
  key = await admin.locator("[data-agent-key-value]").inputValue();
  expect(key).toMatch(/^jbx_agent_/);

  const page = await signedIn(browser, candidate.email);
  await database.query("UPDATE candidate SET name = $2, given_name = 'Camille', family_name = 'Durand-Lefèvre' WHERE lower(email) = lower($1)", [candidate.email, candidate.name]);
  const send = async (message: string, aiNotice: boolean) => {
    const sent = await page.request.post("/api/signalements", { data: { type: "bug", path: "/candidatures", textSize: "standard", aiNotice, message: `${message} ${ref}` }, headers: { origin: own.origin } });
    expect(sent.status(), await sent.text()).toBe(201);
    return (await sent.json()).signalement.id as string;
  };
  id.treatedOld = await send("Le bouton Enregistrer ne répond plus depuis ce matin", true);
  id.treatedRecent = await send("La page des candidatures met très longtemps à s'ouvrir", true);
  id.open = await send("Le sélecteur de date de mon agenda ne s'ouvre jamais", true);
  id.noNotice = await send("Un message envoyé depuis un ancien formulaire sans l'avis", false);
  await page.context().close();

  // Support handled the first two: one 11 months ago (kept), one 13 months ago (purged tonight).
  await database.query("UPDATE signalement SET status = 'traite', reply = 'Merci', status_changed_at = now() - interval '11 months' WHERE id = $1", [id.treatedRecent]);
  await database.query("UPDATE signalement SET status = 'traite', reply = 'Merci', status_changed_at = now() - interval '13 months' WHERE id = $1", [id.treatedOld]);
});

test("a Signalement « traité » stays readable by the key until its purge, read-only: only « vu » can be set, and not on it", async () => {
  const one = await get(`${API}/${id.treatedRecent}`);
  expect(one.status()).toBe(200);
  const body = await one.json();
  expect(body.signalement.status).toBe("traite");
  expect(Object.keys(body.signalement)).toEqual(EXPECTED_KEYS);
  expect(body.signalement.issue).toBeNull();
  expect(body.signalement.brouillon).toBeNull();
  // The team's reply is never in what the key reads.
  expect(JSON.stringify(body)).not.toContain("Merci");

  const queue = await (await get(API)).json();
  const listed = (queue.signalements as { id: string; status: string }[]).filter((each) => [id.treatedOld, id.treatedRecent].includes(each.id));
  expect(listed.map((each) => each.status)).toEqual(["traite", "traite"]);
  expect((queue.signalements as { id: string }[]).map((each) => each.id)).not.toContain(id.noNotice);

  // « vu » is refused on a « traité » one, anything else is no status the key can set; nothing changed.
  expect((await post(`${API}/${id.treatedRecent}/statut`, { statut: "vu" })).status()).toBe(409);
  expect((await post(`${API}/${id.treatedRecent}/statut`, { statut: "nouveau" })).status()).toBe(400);
  expect((await database.query("SELECT status, status_changed_by FROM signalement WHERE id = $1", [id.treatedRecent])).rows[0]).toMatchObject({ status: "traite", status_changed_by: null });
  // « Vu » is still the key's on one not handled.
  const seen = await post(`${API}/${id.open}/statut`, { statut: "vu" });
  expect(seen.status()).toBe(200);
  expect(await seen.json()).toEqual({ id: id.open, statut: "vu", statutMajPar: "key:triage-state" });
  // The agent never sets « traité » through the draft either.
  expect((await post(`${API}/${id.treatedRecent}/brouillon`, { fr: "Merci pour votre signalement.", en: "Thank you for your report." })).status()).toBe(409);
});

test("a Signalement sent without the AI notice answers 404 no_ai_notice, saying nothing of the Candidate", async () => {
  for (const response of [await get(`${API}/${id.noNotice}`), await post(`${API}/${id.noNotice}/statut`, { statut: "vu" }), await post(`${API}/${id.noNotice}/issue`, CLEAN), await post(`${API}/${id.noNotice}/brouillon`, { fr: "Merci.", en: "Thanks." })]) {
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "not_found", reason: "no_ai_notice" });
    expect(Object.keys(body)).toEqual(["error", "reason"]);
  }
  const unknown = await get(`${API}/3f2504e0-4f89-41d3-9a0c-0305e82c3399`);
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({ error: "not_found", reason: "unknown" });
});

test("without the issues token, …/issue says so: 503 missing_token, checked: true once Redaction and the Guardrail passed, nothing published or linked; a blocked text is still a 422", async () => {
  const ok = await post(`${API}/${id.open}/issue`, CLEAN);
  expect(ok.status()).toBe(503);
  const body = await ok.json();
  expect(body).toEqual({ error: "github", reason: "missing_token", checked: true });
  expect(Object.keys(body)).toEqual(["error", "reason", "checked"]);
  expect((await database.query("SELECT count(*)::int AS n FROM signalement_issue WHERE signalement_id = $1", [id.open])).rows[0].n).toBe(0);

  // A text the Guardrail blocks never claims to have been checked.
  const blocked = await post(`${API}/${id.open}/issue`, { ...CLEAN, title: `${candidate.name} ne peut plus enregistrer sa lettre` });
  expect(blocked.status()).toBe(422);
  const refused = await blocked.json();
  expect(refused.error).toBe("blocked");
  expect(refused).not.toHaveProperty("checked");
  expect((await database.query("SELECT count(*)::int AS n FROM signalement_issue")).rows[0].n).toBe(0);
});

test("the nightly purge deletes a Signalement 12 months after « traité » and leaves a minimal trace; the key is then told 404 treated, with nothing of the Candidate", async () => {
  test.setTimeout(240_000);
  const gone = async () => (await database.query("SELECT count(*)::int AS n FROM signalement WHERE id = $1", [id.treatedOld])).rows[0].n === 0;
  await purge(gone);

  expect(await gone()).toBe(true);
  // 11 months after « traité »: still there, still readable.
  expect((await get(`${API}/${id.treatedRecent}`)).status()).toBe(200);
  expect((await get(`${API}/${id.open}`)).status()).toBe(200);

  const response = await get(`${API}/${id.treatedOld}`);
  expect(response.status()).toBe(404);
  const text = await response.text();
  expect(JSON.parse(text)).toEqual({ error: "not_found", reason: "treated" });
  for (const forbidden of [candidate.email, candidate.name, "Camille", "Enregistrer", ref]) expect(text, forbidden).not.toContain(forbidden);
  for (const route of ["statut", "issue", "brouillon"]) {
    const written = await post(`${API}/${id.treatedOld}/${route}`, route === "statut" ? { statut: "vu" } : route === "issue" ? CLEAN : { fr: "Merci.", en: "Thanks." });
    expect(written.status(), route).toBe(404);
    expect(await written.json(), route).toEqual({ error: "not_found", reason: "treated" });
  }
  const queue = await (await get(API)).json();
  expect((queue.signalements as { id: string }[]).map((each) => each.id)).not.toContain(id.treatedOld);

  // The trace is its id, when it went and why: nothing else, not even the Candidate's id.
  const columns = (await database.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'signalement_removed' ORDER BY ordinal_position")).rows.map((row) => row.column_name);
  expect(columns).toEqual(["id", "removed_at", "reason"]);
  const trace = (await database.query("SELECT id::text, reason, removed_at FROM signalement_removed WHERE id = $1", [id.treatedOld])).rows;
  expect(trace).toHaveLength(1);
  expect(trace[0]).toMatchObject({ reason: "treated" });
  expect(Date.now() - trace[0].removed_at.getTime()).toBeLessThan(5 * 60_000);
  // Nothing left of the Signalement and of the Candidate's data in the database but the trace.
  expect((await database.query("SELECT count(*)::int AS n FROM signalement WHERE id = $1", [id.treatedOld])).rows[0].n).toBe(0);
  // Only the one with the notice has a trace.
  expect((await database.query("SELECT count(*)::int AS n FROM signalement_removed WHERE id = $1", [id.noNotice])).rows[0].n).toBe(0);
});

test("the trace is purged 12 months after the Signalement went: the key is then told 404 unknown", async () => {
  test.setTimeout(240_000);
  await database.query("UPDATE signalement_removed SET removed_at = now() - interval '13 months' WHERE id = $1", [id.treatedOld]);
  const forgotten = async () => (await database.query("SELECT count(*)::int AS n FROM signalement_removed WHERE id = $1", [id.treatedOld])).rows[0].n === 0;
  await purge(forgotten);
  const response = await get(`${API}/${id.treatedOld}`);
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found", reason: "unknown" });
});

test("a Signalement deleted by the Candidate leaves its trace and the key is told 404 deleted", async ({ browser }) => {
  const page = await signedIn(browser, candidate.email);
  try {
    const deleted = await page.request.delete(`/api/signalements/${id.open}`, { headers: { origin: own.origin } });
    expect(deleted.status()).toBe(204);
  } finally {
    await page.context().close();
  }
  const response = await get(`${API}/${id.open}`);
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found", reason: "deleted" });
  expect((await database.query("SELECT reason FROM signalement_removed WHERE id = $1", [id.open])).rows).toEqual([{ reason: "deleted" }]);
});

test("the processing register and the procedure say what the trace is for and how long it is kept, and what the key is told", () => {
  const register = readFileSync("docs/privacy/register.md", "utf8").replace(/\s+/g, " ");
  for (const part of ["Trace of a Signalement gone (#1173)", "signalement_removed", "`deleted` by the Candidate", "`treated`, purged 12 months after « traité »", "12 months after it went", "nothing of the Candidate"]) expect(register, part).toContain(part);
  const procedure = readFileSync("docs/agents/issue-tracker.md", "utf8");
  const section = procedure.slice(procedure.indexOf("## Trier les signalements")).replace(/\s+/g, " ");
  for (const part of ["\"id\", \"statut\", \"statutMajPar\"", "\"id\", \"brouillon\"", "already_linked", "\"reason\"", "`issue`", "`brouillon`"]) expect(section, part).toContain(part);
  for (const reason of ["deleted", "treated", "no_ai_notice", "unknown"]) expect(section, reason).toContain(reason);
});
