/**
 * #1141 (ADR-0118) — Signalement triage, second half, end to end through the public entry points: the Agent API over HTTP
 * (`POST /admin/api/signalements/:id/issue` and `…/brouillon`, `Authorization: Bearer jbx_agent_…`), GitHub's REST API
 * (a fake one, on GITHUB_API_URL, that checks which token wrote and which read), the Back Office in the browser (the
 * issues, « Prêt à clore », the draft Support edits, sends or deletes, the Guardrails' Eval Runs, the Help Articles, the
 * Back Office Audit), the Candidate's pages (« Mes signalements », its notification, its Data export), the real worker
 * (`apps/worker`, « Prêt à clore » at each deploy and Livraison's daily email, queued as its cron would) and the
 * procedure in docs/agents/issue-tracker.md.
 * A server of its own (own database) and a fake GitHub: the keys, the Signalements and the issues are the spec's alone.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { PgBoss } from "pg-boss";
import { Pool } from "pg";
import { EXIT_LINK_REL, exitHref } from "./support/exit-page";
import { emailsIn, newAddress } from "./support/mailbox";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { derivedPort } from "./support/ports";

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const keysText = fr.admin.agentKeys;
const office = fr.admin.signalements;
const mine = fr.mySignalements;
const notices = fr.signalementNotifications;
const SUPER_ADMIN = "issue-draft-office@e2e.jobbbox.test";
const PORT_OFFSET = 1141;
const GITHUB_PORT = derivedPort(1142);
const API = "/admin/api/signalements";
const REPOSITORY = "fnconsult/jobhub";
const ISSUES_TOKEN = "github_pat_e2e_issues_write_only";
const STATUS_TOKEN = "github_pat_e2e_status_read_only";
const DIGEST_TO = "livraison-e2e@e2e.jobbbox.test";

let own: OwnServer;
let database: Pool;
let admin: Page;
let anonymous: APIRequestContext;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const tag = () => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });
const issueLink = (number: number) => `https://github.com/${REPOSITORY}/issues/${number}`;
const main = (page: Page) => page.getByRole("main");
const notificationsOf = (page: Page) => page.getByRole("list", { name: notices.label });

// ---------------------------------------------------------------------------------------------------------------------
// GitHub, faked: it takes the issues Jobbbox publishes with the write-only token, answers the worker's reads with the
// read-only one, and refuses a token used for the other's work (as a fine-grained token with one permission would).
// ---------------------------------------------------------------------------------------------------------------------

type GitHubCall = { method: string; path: string; token: string | null; body: Record<string, unknown> | undefined };

class FakeGitHub {
  calls: GitHubCall[] = [];
  /** The issues that exist: closed ones say with which commit. */
  issues = new Map<number, { closedBy: string | null }>();
  /** For each deployed commit, the commits it carries. */
  carries = new Map<string, string[]>();
  private next = 7000;
  private server!: Server;

  async start() {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve) => this.server.listen(GITHUB_PORT, "127.0.0.1", resolve));
  }
  stop() {
    this.server?.close();
  }
  get url() {
    return `http://127.0.0.1:${GITHUB_PORT}`;
  }
  writes = () => this.calls.filter((call) => call.method === "POST" && /\/repos\/[^/]+\/[^/]+\/issues/.test(call.path));
  /** Closes the issue as GitHub does when a pull request's merge closes it: its « closed » event has no commit. */
  close(number: number, mergeCommit: string) {
    this.issues.set(number, { closedBy: mergeCommit });
  }
  /** The pull request whose merge closed the issue `number`. */
  private pullOf = (number: number) => number + 100_000;

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = new URL(request.url!, this.url);
    const token = request.headers.authorization?.replace(/^Bearer /, "") ?? null;
    const method = request.method!;
    const body = raw ? JSON.parse(raw) : undefined;
    this.calls.push({ method, path: `${url.pathname}${url.search}`, token, body });
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(data));
    };
    const repo = `/repos/${REPOSITORY}`;
    const issue = url.pathname.match(new RegExp(`^${repo}/issues/(\\d+)(/comments|/timeline)?$`));
    const pull = url.pathname.match(new RegExp(`^${repo}/pulls/(\\d+)$`));
    // Writes: only the write-only token.
    if (method === "POST" && url.pathname === `${repo}/issues`) {
      if (token !== ISSUES_TOKEN) return send(403, { message: "Resource not accessible by personal access token" });
      const number = this.next++;
      this.issues.set(number, { closedBy: null });
      return send(201, { number, html_url: issueLink(number) });
    }
    if (method === "POST" && issue?.[2] === "/comments") {
      if (token !== ISSUES_TOKEN) return send(403, { message: "Resource not accessible by personal access token" });
      if (!this.issues.has(Number(issue[1]))) return send(404, { message: "Not Found" });
      return send(201, { html_url: `${issueLink(Number(issue[1]))}#issuecomment-1` });
    }
    // Reads: only the read-only token.
    if (method === "GET" || url.pathname.endsWith("/graphql")) {
      if (token !== STATUS_TOKEN) return send(403, { message: "Resource not accessible by personal access token" });
      if (issue && !issue[2]) {
        const known = this.issues.get(Number(issue[1]));
        if (!known) return send(404, { message: "Not Found" });
        return send(200, known.closedBy ? { state: "closed", state_reason: "completed" } : { state: "open", state_reason: null });
      }
      if (issue?.[2] === "/timeline") {
        const closedBy = this.issues.get(Number(issue[1]))?.closedBy;
        if (!closedBy) return send(200, []);
        const pullRequest = { number: this.pullOf(Number(issue[1])), pull_request: { merged_at: "2026-11-26T15:59:06Z" }, repository: { full_name: REPOSITORY } };
        return send(200, [
          { event: "cross-referenced", created_at: "2026-11-26T14:00:00Z", source: { type: "issue", issue: pullRequest } },
          { event: "referenced", commit_id: closedBy, created_at: "2026-11-26T15:59:07Z" },
          { event: "closed", commit_id: null, created_at: "2026-11-26T15:59:08Z", state_reason: null },
        ]);
      }
      if (pull) {
        const closed = [...this.issues].find(([number]) => this.pullOf(number) === Number(pull[1]));
        if (!closed?.[1].closedBy) return send(404, { message: "Not Found" });
        return send(200, { number: Number(pull[1]), merged_at: "2026-11-26T15:59:06Z", merge_commit_sha: closed[1].closedBy });
      }
      const compare = url.pathname.match(new RegExp(`^${repo}/compare/([^.]+)\\.\\.\\.(.+)$`));
      if (compare) return send(200, this.carries.get(compare[2]!)?.includes(compare[1]!) ? { status: "ahead", behind_by: 0, ahead_by: 1 } : { status: "diverged", behind_by: 1, ahead_by: 1 });
      // Livraison's own reads: no environment, no ticket, no pull request.
      if (url.pathname === `${repo}/environments`) return send(200, { environments: [] });
      if (url.pathname === `${repo}/issues`) return send(200, []);
      if (url.pathname === "/search/issues") return send(200, { items: [] });
      if (url.pathname === "/graphql") return send(200, { data: { repository: { pullRequests: { nodes: [] } } } });
    }
    return send(404, { message: "Not Found" });
  }
}

const github = new FakeGitHub();

// ---------------------------------------------------------------------------------------------------------------------
// The worker, run for real on the spec's database.
// ---------------------------------------------------------------------------------------------------------------------

class Worker {
  output = "";
  private child: ChildProcess;
  constructor(databaseUrl: string, env: Record<string, string>) {
    this.child = spawn(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
      cwd: path.resolve("apps/worker"),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        DATABASE_URL: databaseUrl,
        APP_URL: own.origin,
        JOBHUB_IGNORE_ROOT_ENV: "1",
        MAIL_TRANSPORT: "console",
        GITHUB_API_URL: github.url,
        GITHUB_STATUS_TOKEN: STATUS_TOKEN,
        ...env,
      },
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

/** A deploy: a worker starts (each deploy starts it) on `commit`, in `environment`, and is stopped once `done` holds. */
async function deploy(environment: string, commit: string, done: () => Promise<boolean>) {
  const worker = new Worker(own.databaseUrl, { JOBHUB_TARGET: environment, JOBHUB_COMMIT: commit });
  try {
    await worker.started();
    await expect.poll(done, { timeout: 60_000, intervals: [500], message: `the deploy of ${commit} is read (worker output: ${worker.output})` }).toBe(true);
  } finally {
    await worker.stop();
  }
}

/** Queues one of the worker's jobs as its cron would. */
async function queue(job: string) {
  const boss = new PgBoss({ connectionString: own.databaseUrl });
  boss.on("error", () => {});
  await boss.start();
  try {
    await boss.send(job, {});
  } finally {
    await boss.stop({ graceful: false });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------------------------

async function signedIn(browser: Browser, email: string, locale = "fr-FR"): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: own.origin, locale })).newPage();
  await signInByEmail(page, own, email);
  return page;
}

async function createKey(name: string): Promise<string> {
  await admin.goto("/admin/parametres?tab=cles-agent");
  await admin.getByLabel(keysText.create.name).fill(name);
  await admin.getByLabel(keysText.create.days).fill("90");
  await admin.getByRole("button", { name: keysText.create.submit }).click();
  return admin.locator("[data-agent-key-value]").inputValue();
}

test.beforeAll(async ({ browser }) => {
  await github.start();
  own = await startOwnServer(PORT_OFFSET, "issue_draft", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    ADMIN_EMAILS: SUPER_ADMIN,
    AUTH_SECRET: "issue-draft-e2e-secret-issue-draft-e2e-secret",
    MAIL_TRANSPORT: "console",
    GITHUB_API_URL: github.url,
    GITHUB_ISSUES_TOKEN: ISSUES_TOKEN,
    GITHUB_STATUS_TOKEN: STATUS_TOKEN,
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
    STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    // The Guardrails' AI checks on the suite's fake Mistral: saving a setting plays the Eval Cases, and « Périmètre du
    // coach »'s check 3 is the model's to judge (ADR-0119), so a server with no model could save none.
    // The guardrail and eval tasks follow the coaching task's provider (packages/ai/src/env.ts).
    AI_COACHING_PROVIDER: "mistral",
    MISTRAL_API_KEY: "e2e-mistral-key",
    NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-mistral.mjs")}`,
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
    github.stop();
  }
});

test.describe.configure({ mode: "serial" });

// A key's calls are rate limited (30 a minute): each test starts in a new window, as if a minute had passed.
test.beforeEach(async () => {
  await database.query("UPDATE agent_key_call SET at = at - interval '2 minutes'");
});

const ref = tag();
const camille = { email: newAddress("issue-draft-camille"), name: "Camille Durand-Lefèvre", page: undefined as unknown as Page };
const olivia = { email: newAddress("issue-draft-olivia"), name: "Olivia Smith-Hart", page: undefined as unknown as Page };
const phone = "06 21 43 65 87";
let key: string;
/** The Signalements of the spec, by what they are for. */
const id = {} as Record<"bugA" | "bugB" | "bugC" | "bugD" | "idee" | "question" | "question2", string>;
/** The issues: A's (opened, B comments on it), C's and D's. */
const issue = {} as Record<"a" | "c" | "d", number>;

const post = (path: string, data: unknown, token: string | null = key) => anonymous.post(`${own.origin}${path}`, { headers: token ? bearer(token) : {}, data });
const get = (path: string, token: string | null = key) => anonymous.get(`${own.origin}${path}`, { headers: token ? bearer(token) : {} });
const proposeIssue = (signalement: string, data: unknown) => post(`${API}/${signalement}/issue`, data);
const proposeDraft = (signalement: string, data: unknown) => post(`${API}/${signalement}/brouillon`, data);
const rowOf = async (signalement: string) => (await database.query("SELECT status, reply, ready_to_close_at FROM signalement WHERE id = $1", [signalement])).rows[0];
const linksOf = async (signalement: string) => (await database.query("SELECT issue_number FROM signalement_issue WHERE signalement_id = $1 ORDER BY issue_number", [signalement])).rows.map((row) => row.issue_number as number);
const triggers = async () => Number((await database.query("SELECT count(*) FROM guardrail_trigger WHERE guardrail = 'candidate_data_in_issue' AND action = 'blocked' AND agent = 'signalement_triage'")).rows[0].count);

/** What the agent proposes for a clean issue, in its own words. */
const CLEAN = {
  title: "Écran vide après l'enregistrement d'une lettre de motivation",
  summary: "Enregistrer une lettre de motivation vide l'écran ; le texte saisi disparaît.",
  steps: "1. Ouvrir une candidature.\n2. Rédiger une lettre.\n3. Cliquer sur le bouton d'enregistrement.",
  expected: "La lettre est enregistrée et reste affichée.",
  environment: "Beta",
  version: "1.42.0 (main·35e2ea1)",
  device: "Chrome 141, Mac",
};

test("setup: an Agent Key, two Candidates (one in English) and the Signalements they sent with the AI notice", async ({ browser }) => {
  test.setTimeout(300_000);
  key = await createKey("triage-beta");
  expect(key).toMatch(/^jbx_agent_/);

  camille.page = await signedIn(browser, camille.email);
  olivia.page = await signedIn(browser, olivia.email, "en-US");
  const switched = await olivia.page.request.post("/api/auth/update-user", { data: { interfaceLanguage: "en" }, headers: { origin: own.origin } });
  expect(switched.ok(), await switched.text()).toBe(true);
  await database.query("UPDATE candidate SET name = $2, given_name = 'Camille', family_name = 'Durand-Lefèvre' WHERE lower(email) = lower($1)", [camille.email, camille.name]);
  await database.query("UPDATE candidate SET name = $2, given_name = 'Olivia', family_name = 'Smith-Hart' WHERE lower(email) = lower($1)", [olivia.email, olivia.name]);

  const send = async (page: Page, data: Record<string, unknown>) => {
    const sent = await page.request.post("/api/signalements", { data: { path: "/candidatures", textSize: "standard", aiNotice: true, ...data }, headers: { origin: own.origin } });
    expect(sent.status(), await sent.text()).toBe(201);
    const body = await sent.json();
    // The Candidate's own copy of a Signalement never says anything of an issue.
    expect(JSON.stringify(body)).not.toMatch(/issue/i);
    return body.signalement.id as string;
  };
  id.bugA = await send(camille.page, { type: "bug", message: `Quand je clique sur Enregistrer dans ma lettre la page devient toute blanche et je perds mon texte ${ref}` });
  id.bugB = await send(camille.page, { type: "bug", message: `Ma lettre de motivation disparaît après un clic sur le bouton Enregistrer ${ref}` });
  id.bugC = await send(camille.page, { type: "bug", message: `Le menu des candidatures reste bloqué sur mon téléphone ${ref}` });
  id.bugD = await send(camille.page, { type: "bug", message: `Le sélecteur de date de mon agenda ne s'ouvre jamais ${ref}` });
  id.idee = await send(camille.page, { type: "idee", message: `Pouvoir trier mes candidatures par date de relance ${ref}` });
  id.question = await send(olivia.page, {
    type: "question",
    message: `The help did not tell me how to change my plan ${ref}`,
    attachedQuestion: `How do I switch to the Standard plan? ${ref}`,
    attachedCoachReply: `I could not find an article about this ${ref}`,
  });
  id.question2 = await send(olivia.page, {
    type: "question",
    message: `Where can I download my data in a file ${ref}`,
    attachedQuestion: `Where is my export? ${ref}`,
    attachedCoachReply: `Open your account ${ref}`,
  });
});

test("a text that names the Candidate, quotes their message word for word, or holds an e-mail or a phone is blocked: 422 with the reason, nothing published, the Guardrail Trigger recorded", async () => {
  const published = github.writes().length;
  const before = await triggers();
  const cases: { name: string; data: Record<string, unknown>; reasons: string[]; fields: string[] }[] = [
    { name: "the Candidate's name", data: { ...CLEAN, title: `${camille.name} ne peut plus enregistrer sa lettre` }, reasons: ["identity"], fields: ["title"] },
    { name: "a quote of their message", data: { ...CLEAN, summary: "La candidate écrit que la page devient toute blanche et qu'elle perd tout." }, reasons: ["verbatim_quote"], fields: ["summary"] },
    { name: "their e-mail", data: { ...CLEAN, steps: `1. Se connecter avec ${camille.email}.\n2. Rédiger une lettre.` }, reasons: ["email"], fields: ["steps"] },
    { name: "a phone", data: { ...CLEAN, steps: `1. Appeler le ${phone}.\n2. Rédiger une lettre.` }, reasons: ["phone"], fields: ["steps"] },
    { name: "an e-mail and a phone in the steps", data: { ...CLEAN, steps: `Se connecter avec ${camille.email} (${phone}).` }, reasons: ["email", "phone"], fields: ["steps"] },
    { name: "a duplicate's comment that quotes", data: { commentOn: 1, summary: "Elle dit : la page devient toute blanche et je perds mon texte." }, reasons: ["verbatim_quote"], fields: ["summary"] },
  ];
  for (const each of cases) {
    const response = await proposeIssue(id.bugA, each.data);
    expect(response.status(), each.name).toBe(422);
    expect(await response.json(), each.name).toEqual({ error: "blocked", guardrail: "candidate_data_in_issue", reasons: each.reasons, fields: each.fields });
  }
  // Nothing went to GitHub, nothing was linked, and each block is a Guardrail Trigger (without any text).
  expect(github.writes()).toHaveLength(published);
  expect(await linksOf(id.bugA)).toEqual([]);
  expect((await triggers()) - before).toBe(cases.length);
  const dump = JSON.stringify((await database.query("SELECT * FROM guardrail_trigger WHERE guardrail = 'candidate_data_in_issue'")).rows);
  for (const forbidden of [ref, camille.email, "Camille", phone, "toute blanche"]) expect(dump, forbidden).not.toContain(forbidden);

  // The Guardrail's own words in English also quote: not a way round (case, accents and punctuation aside).
  const loud = await proposeIssue(id.bugA, { ...CLEAN, summary: "LA PAGE, DEVIENT: toute blanche et je perds." });
  expect(loud.status()).toBe(422);
  expect((await loud.json()).reasons).toEqual(["verbatim_quote"]);
});

test("POST …/issue: the agent's own words, checked by Jobbbox, published on fnconsult/jobhub with the write-only token, labelled, carrying the Signalement's id and never its text", async () => {
  // Never without a key; never a read-only call (the key opens this route and nothing else).
  expect((await post(`${API}/${id.bugA}/issue`, CLEAN, null)).status()).toBe(401);
  expect((await post(`${API}/${id.bugA}/issue`, CLEAN, `jbx_agent_${"x".repeat(43)}`)).status()).toBe(401);
  // A body that is not an issue, a Signalement that does not exist: nothing published.
  expect((await proposeIssue(id.bugA, { summary: "Sans titre" })).status()).toBe(400);
  expect((await proposeIssue(id.bugA, [])).status()).toBe(400);
  const unknown = await proposeIssue("00000000-0000-4000-8000-000000000000", CLEAN);
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({ error: "not_found", reason: "unknown" });
  expect(github.writes()).toHaveLength(0);

  const response = await proposeIssue(id.bugA, CLEAN);
  expect(response.status(), await response.text()).toBe(201);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const { issue: published } = await response.json();
  expect(published).toMatchObject({ kind: "opened", url: expect.stringContaining(`/${REPOSITORY}/issues/`) });
  issue.a = published.number;
  expect(published.url).toBe(issueLink(issue.a));

  // On GitHub: one issue, written with the Provider Secret that only writes issues, never the status token.
  expect(github.writes()).toHaveLength(1);
  const opened = github.writes()[0]!;
  expect(opened.path).toBe(`/repos/${REPOSITORY}/issues`);
  expect(opened.token).toBe(ISSUES_TOKEN);
  expect(opened.body!.labels).toEqual(["needs-triage", "signalement"]);
  expect(opened.body!.title).toBe(CLEAN.title);
  // Title, summary, steps, expected behaviour, environment, Version, device; the Signalement's id.
  for (const part of [CLEAN.summary, CLEAN.steps, CLEAN.expected, "Beta", "1.42.0 (main·35e2ea1)", "Chrome 141, Mac", id.bugA]) expect(opened.body!.body, part).toContain(part);
  // Never the Candidate's words, name or email.
  for (const forbidden of [ref, "la page devient toute blanche", "Camille", "Durand", camille.email]) expect(JSON.stringify(opened.body), forbidden).not.toContain(forbidden);

  // The link, kept on the Signalement; the status is the team's to set.
  expect(await linksOf(id.bugA)).toEqual([issue.a]);
  expect((await rowOf(id.bugA)).status).toBe("nouveau");

  // One issue per Signalement (#1173): a second, or a comment, is refused, naming the issue it has.
  const again = await proposeIssue(id.bugA, CLEAN);
  expect(again.status()).toBe(409);
  expect(await again.json()).toEqual({ error: "already_linked", issue: { number: issue.a, url: issueLink(issue.a) } });
  expect((await proposeIssue(id.bugA, { commentOn: 1 })).status()).toBe(409);
  expect(github.writes()).toHaveLength(1);

  // Redaction's placeholders name no one: they go through.
  expect((await proposeIssue(id.bugC, { ...CLEAN, title: "Menu bloqué sur téléphone", summary: "[NOM] signale un menu bloqué ; contact [E-MAIL]." })).status()).toBe(201);
  const placeholder = github.writes().at(-1)!;
  issue.c = Number((await database.query("SELECT issue_number FROM signalement_issue WHERE signalement_id = $1", [id.bugC])).rows[0].issue_number);
  expect(placeholder.body!.title).toBe("Menu bloqué sur téléphone");
});

test("a duplicate: { commentOn } comments on the issue named, with the new Signalement's id, and links it; an issue that does not exist is a 404", async () => {
  const response = await proposeIssue(id.bugB, { commentOn: issue.a, summary: "Même écran vide, vu sur un autre appareil." });
  expect(response.status(), await response.text()).toBe(201);
  expect((await response.json()).issue).toEqual({ number: issue.a, url: `${issueLink(issue.a)}#issuecomment-1`, kind: "commented" });
  const comment = github.writes().at(-1)!;
  expect(comment.path).toBe(`/repos/${REPOSITORY}/issues/${issue.a}/comments`);
  expect(comment.token).toBe(ISSUES_TOKEN);
  expect(comment.body!.body).toContain(id.bugB);
  expect(comment.body!.body).toContain("Même écran vide");
  expect(JSON.stringify(comment.body)).not.toContain(ref);
  expect(await linksOf(id.bugB)).toEqual([issue.a]);
  // One issue, two Signalements.
  expect((await database.query("SELECT count(*)::int AS n FROM signalement_issue WHERE issue_number = $1", [issue.a])).rows[0].n).toBe(2);

  const published = github.writes().length;
  const unknown = await proposeIssue(id.bugD, { commentOn: 999_999 });
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({ error: "issue_not_found" });
  expect((await proposeIssue(id.bugD, { commentOn: "12" })).status()).toBe(400);
  expect((await proposeIssue(id.bugD, { commentOn: 0 })).status()).toBe(400);
  expect(github.writes().length).toBe(published + 1);
  expect(await linksOf(id.bugD)).toEqual([]);

  // D has an issue of its own, for the deletion below.
  expect((await proposeIssue(id.bugD, { ...CLEAN, title: "Sélecteur de date de l'agenda sans effet", summary: "Le sélecteur de date de l'agenda ne s'ouvre pas." })).status()).toBe(201);
  issue.d = (await linksOf(id.bugD))[0]!;
});

test("the link goes both ways: the issue's number is in the Back Office for the team, and the Candidate never sees it; deleting the Signalement removes the link and leaves the issue", async () => {
  test.setTimeout(240_000);
  // The team, in the Back Office: each issue, with its link through the Exit Page, and how it was linked.
  await admin.goto(`/admin/signalements/${id.bugA}`);
  const card = admin.locator("[data-issues]");
  await expect(card.getByRole("link", { name: `#${issue.a}` })).toBeVisible();
  await expect(card).toContainText(tr(office.issueKinds.opened, { key: "triage-beta", date: "" }).split(",")[0]!);
  await expect(admin.getByRole("heading", { name: office.issuesTitle })).toBeVisible();
  await admin.goto(`/admin/signalements/${id.bugB}`);
  await expect(admin.locator("[data-issues]").getByRole("link", { name: `#${issue.a}` })).toBeVisible();
  await expect(admin.locator("[data-issues]")).toContainText(tr(office.issueKinds.commented, { key: "triage-beta", date: "" }).split(",")[0]!);
  // Not on a Signalement without an issue.
  await admin.goto(`/admin/signalements/${id.idee}`);
  await expect(admin.locator("[data-issues]")).toHaveCount(0);

  // The Candidate: nowhere in « Mes signalements », its page, the notification route or the Signalement's own answer.
  await camille.page.goto("/compte/signalements");
  await expect(main(camille.page).getByRole("heading", { name: mine.title, level: 2 })).toBeVisible();
  const html = await camille.page.content();
  for (const forbidden of [String(issue.a), `/issues/${issue.a}`, "github.com", fr.admin.signalements.readyToClose, office.issuesTitle]) expect(html, forbidden).not.toContain(forbidden);
  // Their Data export (a right of access) holds the numbers, and nothing of who linked them.
  await camille.page.goto("/compte/donnees");
  const [file] = await Promise.all([camille.page.waitForEvent("download"), camille.page.getByRole("region", { name: fr.accountData.title }).getByRole("link", { name: fr.accountData.export }).click()]);
  const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));
  const exportedA = exported.signalements.find((each: { id: string }) => each.id === id.bugA);
  expect(exportedA.issueNumbers).toEqual([issue.a]);
  expect(JSON.stringify(exported)).not.toContain("triage-beta");
  expect(JSON.stringify(exported)).not.toContain("key:");

  // Deleted by the Candidate: the link goes, the other Signalement's stays, and GitHub is not touched.
  const calls = github.calls.length;
  const deleted = await camille.page.request.delete(`/api/signalements/${id.bugD}`, { headers: { origin: own.origin } });
  expect(deleted.status()).toBe(204);
  expect(await linksOf(id.bugD)).toEqual([]);
  expect((await database.query("SELECT count(*)::int AS n FROM signalement_issue WHERE issue_number = $1", [issue.d])).rows[0].n).toBe(0);
  expect(await linksOf(id.bugB)).toEqual([issue.a]);
  expect(github.calls.length).toBe(calls);
  expect(github.issues.has(issue.d)).toBe(true);
  expect((await admin.goto(`/admin/signalements/${id.bugD}`))!.status()).toBe(404);
  // The key is told why, never anything of the Candidate (#1173): only its id and when it went are kept.
  const gone = await get(`${API}/${id.bugD}`);
  expect(gone.status()).toBe(404);
  expect(await gone.json()).toEqual({ error: "not_found", reason: "deleted" });
  expect((await database.query("SELECT reason FROM signalement_removed WHERE id = $1", [id.bugD])).rows).toEqual([{ reason: "deleted" }]);
});

test("POST …/brouillon keeps the draft in the Candidate's language and its translation, « proposé par <key> »; the agent never sends it and never sets « traité »", async () => {
  const drafts = {
    bugA: { fr: `Merci de votre signalement : le correctif est en ligne, l'écran ne devrait plus se vider. ${tag()}`, en: `Thank you for your report: the fix is live. ${tag()}` },
    idee: { fr: `Merci pour cette idée de tri par relance ; nous ne la retenons pas pour l'instant. ${tag()}`, en: `Thank you for this idea; we are not keeping it for now. ${tag()}` },
    question: { fr: `Pour changer d'offre, ouvrez Mon compte puis Abonnement. ${tag()}`, en: `To change your plan, open My account then Subscription. ${tag()}` },
    question2: { fr: `Vos données se téléchargent depuis Mon compte, rubrique Données. ${tag()}`, en: `You can download your data from My account, Data. ${tag()}` },
  };
  Object.assign(globalThis, { __drafts: drafts });
  // Refused: no key, a draft missing a language, a text too long, the agent's « traité » is no draft.
  expect((await post(`${API}/${id.idee}/brouillon`, drafts.idee, null)).status()).toBe(401);
  expect((await proposeDraft(id.idee, { fr: drafts.idee.fr })).status()).toBe(400);
  expect((await proposeDraft(id.idee, { fr: drafts.idee.fr, en: "x".repeat(2_001) })).status()).toBe(400);
  expect((await proposeDraft(id.idee, { fr: "", en: "" })).status()).toBe(400);
  expect((await proposeDraft("00000000-0000-4000-8000-000000000000", drafts.idee)).status()).toBe(404);
  expect((await database.query("SELECT count(*)::int AS n FROM signalement_draft")).rows[0].n).toBe(0);

  const french = await proposeDraft(id.idee, drafts.idee);
  expect(french.status(), await french.text()).toBe(201);
  // The answer: who proposed it and when, never its text (#1173).
  const body = await french.json();
  expect(Object.keys(body)).toEqual(["id", "brouillon"]);
  expect(body).toEqual({ id: id.idee, brouillon: { proposePar: "key:triage-beta", date: expect.any(String) } });
  expect(Number.isNaN(Date.parse(body.brouillon.date))).toBe(false);
  expect((await database.query("SELECT fr, en, proposed_by FROM signalement_draft WHERE signalement_id = $1", [id.idee])).rows[0]).toEqual({ fr: drafts.idee.fr, en: drafts.idee.en, proposed_by: "key:triage-beta" });
  // GET shows it the same way, so a later pass knows a draft waits.
  expect((await (await get(`${API}/${id.idee}`)).json()).signalement.brouillon).toEqual(body.brouillon);
  const english = await proposeDraft(id.question, drafts.question);
  expect(english.status()).toBe(201);
  expect(JSON.stringify(await english.json())).not.toContain(drafts.question.en);
  for (const [name, draft] of [["bugA", drafts.bugA], ["question2", drafts.question2]] as const) expect((await proposeDraft(id[name], draft)).status(), name).toBe(201);
  // A new draft replaces the last one.
  const replaced = { fr: `Version remplacée. ${tag()}`, en: `Replaced version. ${tag()}` };
  expect((await proposeDraft(id.idee, replaced)).status()).toBe(201);
  expect((await database.query("SELECT count(*)::int AS n FROM signalement_draft WHERE signalement_id = $1", [id.idee])).rows[0].n).toBe(1);
  expect((await proposeDraft(id.idee, drafts.idee)).status()).toBe(201);

  // No status changed, no reply set, the Candidate was told nothing; and « traité » is never the agent's.
  for (const [name, each] of Object.entries(id)) if (name !== "bugD") expect((await rowOf(each)).status, name).toBe("nouveau");
  for (const each of ["bugA", "idee", "question"] as const) expect((await rowOf(id[each])).reply).toBeNull();
  for (const statut of ["traite", "traité"]) expect((await post(`${API}/${id.idee}/statut`, { statut })).status()).toBe(400);
  await camille.page.goto("/agenda");
  await expect(camille.page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(notificationsOf(camille.page)).toHaveCount(0);

  // A Signalement already « traité » takes no draft: 409; it stays readable by the key (#1173).
  await database.query("UPDATE signalement SET status = 'traite' WHERE id = $1", [id.bugC]);
  expect(await (await proposeDraft(id.bugC, drafts.idee)).json()).toEqual({ error: "already_handled" });
  expect((await (await get(`${API}/${id.bugC}`)).json()).signalement).toMatchObject({ status: "traite", issue: { number: issue.c }, brouillon: null });
  await database.query("UPDATE signalement SET status = 'nouveau' WHERE id = $1", [id.bugC]);
});

test("in the Back Office, Support reads the draft and its translation, edits it, deletes one, and sends one: the Candidate gets one notification and only the version in their language, signed « L'équipe Jobbbox »", async () => {
  test.setTimeout(240_000);
  const drafts = (globalThis as unknown as { __drafts: Record<string, { fr: string; en: string }> }).__drafts;
  const draftBox = (language: "fr" | "en") => admin.locator(`[data-draft] textarea[name="${language}"]`);

  // The list says which Signalement waits for a draft to send.
  await admin.goto("/admin/signalements?statut=tous");
  await expect(admin.getByRole("row").filter({ hasText: `Pouvoir trier mes candidatures par date de relance ${ref}` })).toContainText(office.draftWaiting);

  // Read: « Brouillon proposé par triage-beta », the version for the Candidate (here French) and its translation.
  await admin.goto(`/admin/signalements/${id.idee}`);
  await expect(admin.locator("[data-draft]")).toContainText(tr(office.draftProposedBy, { key: "triage-beta", date: "" }).split(" le ")[0]!);
  await expect(draftBox("fr")).toHaveValue(drafts.idee!.fr);
  await expect(draftBox("en")).toHaveValue(drafts.idee!.en);
  await expect(admin.getByLabel(tr(office.draftSentVersion, { language: fr.languages.fr }))).toBeVisible();
  await expect(admin.getByLabel(tr(office.draftTranslation, { language: fr.languages.en }))).toBeVisible();
  await expect(admin.locator("[data-draft]")).toContainText(tr(office.draftHelp, { language: fr.languages.fr }));

  // Edited: kept, still « proposé par triage-beta », marked edited; the agent's other fields are as they were.
  const edited = `Merci pour cette idée de tri par relance ; elle rejoint notre liste, nous reviendrons vers vous. ${tag()}`;
  await draftBox("fr").fill(edited);
  await admin.getByRole("button", { name: office.saveDraft }).click();
  await expect(main(admin).getByRole("status")).toHaveText(office.notices.draftSaved);
  await expect(draftBox("fr")).toHaveValue(edited);
  await expect(admin.locator("[data-draft]")).toContainText("triage-beta");
  await expect(admin.locator("[data-draft]")).toContainText(tr(office.draftEdited, { date: "" }).trim().split(" ")[0]!);
  expect((await rowOf(id.idee)).status).toBe("nouveau");

  // Deleted: the second Question's draft is gone, nothing sent, nothing notified.
  await admin.goto(`/admin/signalements/${id.question2}`);
  await admin.getByRole("button", { name: office.removeDraft }).click();
  await expect(main(admin).getByRole("status")).toHaveText(office.notices.draftRemoved);
  await expect(admin.locator("[data-draft]")).toHaveCount(0);
  expect((await database.query("SELECT count(*)::int AS n FROM signalement_draft WHERE signalement_id = $1", [id.question2])).rows[0].n).toBe(0);
  expect((await rowOf(id.question2)).status).toBe("nouveau");

  // Sent: an Idée refused, with no issue, as soon as its draft is ready. « Traité » goes with the reply.
  await admin.goto(`/admin/signalements/${id.idee}`);
  await admin.getByRole("button", { name: office.sendDraft }).click();
  await expect(main(admin).getByRole("status")).toHaveText(office.notices.draftSent);
  const sent = await rowOf(id.idee);
  expect(sent).toMatchObject({ status: "traite", reply: edited });
  expect(sent.reply).not.toContain(drafts.idee!.en);
  expect((await database.query("SELECT count(*)::int AS n FROM signalement_draft WHERE signalement_id = $1", [id.idee])).rows[0].n).toBe(0);
  await expect(main(admin)).toContainText(office.replyLocked);
  await expect(main(admin)).not.toContainText(SUPER_ADMIN.split("@")[0]!);

  // The Candidate: one notification for the reply and « traité » together, then the reply, signed by the team, in French.
  await camille.page.goto("/agenda");
  await expect(notificationsOf(camille.page).getByRole("listitem")).toHaveCount(1);
  await camille.page.goto("/compte/signalements");
  const item = main(camille.page).getByRole("listitem").filter({ hasText: `Pouvoir trier mes candidatures par date de relance ${ref}` });
  await expect(item).toContainText(tr(mine.status, { status: mine.statuses.traite }));
  const reply = item.getByRole("region", { name: mine.reply });
  await expect(reply).toContainText(edited);
  await expect(reply).not.toContainText(drafts.idee!.en);
  expect(await camille.page.content()).not.toContain("triage-beta");
  await camille.page.goto("/agenda");
  await expect(notificationsOf(camille.page)).toHaveCount(0);

  // An English-speaking Candidate: a Question without any issue, its draft sent by Support, received in English only.
  await admin.goto(`/admin/signalements/${id.question}`);
  await expect(draftBox("en")).toHaveValue(drafts.question!.en);
  await expect(admin.getByLabel(tr(office.draftSentVersion, { language: fr.languages.en }))).toBeVisible();
  await admin.getByRole("button", { name: office.sendDraft }).click();
  await expect(main(admin).getByRole("status")).toHaveText(office.notices.draftSent);
  expect((await rowOf(id.question)).status).toBe("traite");
  await olivia.page.goto("/agenda");
  await expect(olivia.page.getByRole("list", { name: en.signalementNotifications.label }).getByRole("listitem")).toHaveCount(1);
  await olivia.page.goto("/compte/signalements");
  const answered = olivia.page.getByRole("main").getByRole("listitem").filter({ hasText: `The help did not tell me how to change my plan ${ref}` });
  await expect(answered.getByRole("region", { name: en.mySignalements.reply })).toContainText(drafts.question!.en);
  await expect(olivia.page.getByRole("main")).not.toContainText(drafts.question!.fr);

  // The Back Office Audit: who, the statuses before and after, a reply « brouillon envoyé » — never a word of it.
  await admin.goto("/admin/journal?section=signalements");
  await expect(main(admin)).not.toContainText(ref);
  for (const [signalement, text] of [[id.idee, edited], [id.question, drafts.question!.en]] as const) {
    const entry = admin.getByRole("row").filter({ hasText: signalement });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(SUPER_ADMIN);
    await expect(entry).toContainText(office.statuses.nouveau);
    await expect(entry).toContainText(office.statuses.traite);
    await expect(entry).toContainText(office.replyStates.sent_draft);
    expect(await entry.innerText()).not.toContain(text.slice(0, 40));
    expect(await entry.locator("time").count()).toBeGreaterThan(0);
  }
  // Editing and deleting a draft are not in it (only the sending): two entries for the two sends.
  await expect(admin.getByRole("row").filter({ hasText: id.question2 })).toHaveCount(0);

  // A draft is no more once sent: a Signalement « traité » takes none, and sending twice is refused.
  expect((await proposeDraft(id.idee, drafts.idee)).status()).toBe(409);
});

test("at each deploy, the issues the deployed commit closes make their Signalements « Prêt à clore », together, in their own environment; the Candidate sees nothing of it", async () => {
  test.setTimeout(420_000);
  const ready = async () => (await database.query("SELECT id::text FROM signalement WHERE ready_to_close_at IS NOT NULL ORDER BY created_at")).rows.map((row) => row.id as string);
  const checked = async (commit: string, numbers: number[]) =>
    (await database.query("SELECT count(*)::int AS n FROM signalement_issue WHERE issue_number = ANY($1::int[]) AND checked_commit = $2", [numbers, commit])).rows[0].n === (await database.query("SELECT count(*)::int AS n FROM signalement_issue WHERE issue_number = ANY($1::int[])", [numbers])).rows[0].n;

  // The fix of issue A is in commit fix-a; the issue is closed by it. C's issue is still open.
  github.close(issue.a, "fixa00000000000000000000000000000000000000");
  github.carries.set("prod0000000000000000000000000000000000000", []);
  github.carries.set("beta1000000000000000000000000000000000000", ["fixa00000000000000000000000000000000000000"]);
  github.carries.set("beta2000000000000000000000000000000000000", ["fixa00000000000000000000000000000000000000", "fixc00000000000000000000000000000000000000"]);

  // Production runs the Promoted Version, which does not carry the fix yet: its Signalements stay as they are.
  await deploy("production", "prod0000000000000000000000000000000000000", () => checked("prod0000000000000000000000000000000000000", [issue.a, issue.c]));
  expect(await ready()).toEqual([]);

  // A Beta deploy that carries the fix: A and B, which share the issue, become « Prêt à clore » together; C's issue is open.
  await deploy("e2e", "beta1000000000000000000000000000000000000", () => checked("beta1000000000000000000000000000000000000", [issue.a, issue.c]));
  expect(await ready()).toEqual([id.bugA, id.bugB]);
  const rows = (await database.query("SELECT id::text, ready_to_close_at, status FROM signalement WHERE id = ANY($1::uuid[])", [[id.bugA, id.bugB]])).rows;
  expect(rows[0].ready_to_close_at.getTime()).toBe(rows[1].ready_to_close_at.getTime());
  expect(rows.map((row) => row.status)).toEqual(["nouveau", "nouveau"]);
  expect((await rowOf(id.bugC)).ready_to_close_at).toBeNull();

  // The commit that closes C's issue arrives with the next deploy.
  github.close(issue.c, "fixc00000000000000000000000000000000000000");
  await deploy("e2e", "beta2000000000000000000000000000000000000", () => checked("beta2000000000000000000000000000000000000", [issue.c]));
  expect(await ready()).toEqual([id.bugA, id.bugB, id.bugC]);

  // The worker read GitHub with the read-only token, and wrote nothing.
  const reads = github.calls.filter((call) => call.method === "GET" && /\/(issues\/\d+|compare)/.test(call.path));
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every((call) => call.token === STATUS_TOKEN)).toBe(true);

  // Team only: the Back Office says so, in the list and on the Signalement; the Candidate's pages and status do not.
  await admin.goto("/admin/signalements?statut=tous");
  await expect(admin.getByRole("row").filter({ hasText: `Quand je clique sur Enregistrer dans ma lettre la page devient toute blanche` })).toContainText(office.readyToClose);
  await expect(admin.getByRole("row").filter({ hasText: `Ma lettre de motivation disparaît après un clic` })).toContainText(office.readyToClose);
  await expect(admin.getByRole("row").filter({ hasText: `Le menu des candidatures reste bloqué` })).toContainText(office.readyToClose);
  await admin.goto(`/admin/signalements/${id.bugA}`);
  await expect(main(admin).getByRole("status").filter({ hasText: office.readyToCloseSince.split("{{")[0]!.trim() })).toBeVisible();
  await camille.page.goto("/compte/signalements");
  await expect(main(camille.page).getByRole("heading", { name: mine.title, level: 2 })).toBeVisible();
  expect(await camille.page.content()).not.toContain(office.readyToClose);
  const item = main(camille.page).getByRole("listitem").filter({ hasText: `Quand je clique sur Enregistrer dans ma lettre` });
  await expect(item).toContainText(tr(mine.status, { status: mine.statuses.nouveau }));
  await camille.page.goto("/agenda");
  await expect(notificationsOf(camille.page)).toHaveCount(0);
  // The agent's queue still says « nouveau »: « Prêt à clore » is no status the agent reads.
  const queue = await (await anonymous.get(`${own.origin}${API}/${id.bugA}`, { headers: bearer(key) })).json();
  expect(queue.signalement.status).toBe("nouveau");
  expect(JSON.stringify(queue)).not.toMatch(/ready|clore/i);
});

test("once « Prêt à clore », Support sends the draft: « traité » and the reply go in one notification, in the Candidate's language, signed by the team", async () => {
  test.setTimeout(240_000);
  const drafts = (globalThis as unknown as { __drafts: Record<string, { fr: string; en: string }> }).__drafts;
  await admin.goto(`/admin/signalements/${id.bugA}`);
  await expect(admin.locator("[data-draft] textarea[name='fr']")).toHaveValue(drafts.bugA!.fr);
  await admin.getByRole("button", { name: office.sendDraft }).click();
  await expect(main(admin).getByRole("status")).toHaveText(office.notices.draftSent);
  expect(await rowOf(id.bugA)).toMatchObject({ status: "traite", reply: drafts.bugA!.fr });
  // Its sister Signalement (the duplicate) is not touched: Support sends each reply.
  expect((await rowOf(id.bugB)).status).toBe("nouveau");

  await camille.page.goto("/agenda");
  const list = notificationsOf(camille.page).getByRole("listitem");
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText(/signalement du/);
  await camille.page.goto("/compte/signalements");
  const item = main(camille.page).getByRole("listitem").filter({ hasText: `Quand je clique sur Enregistrer dans ma lettre` });
  await expect(item.getByRole("region", { name: mine.reply })).toContainText(drafts.bugA!.fr);
  await expect(item).toContainText(tr(mine.status, { status: mine.statuses.traite }));
  expect(await camille.page.content()).not.toContain(drafts.bugA!.en);
  // A Signalement « traité » is no longer checked at a deploy.
  expect((await database.query("SELECT count(*)::int AS n FROM signalement WHERE status = 'traite' AND ready_to_close_at IS NOT NULL")).rows[0].n).toBe(1);
});

test("Livraison's daily email gains a « Signalements » section from Jobbbox: numbers and links only, never a Candidate's text; the triage's last pass, or why it did not happen", async () => {
  test.setTimeout(300_000);
  const mailsOf = (worker: Worker) => emailsIn(worker.output, DIGEST_TO);
  const run = async (expected: number, worker: Worker) => {
    await queue("delivery-status.email");
    await expect.poll(() => mailsOf(worker).length, { timeout: 60_000, intervals: [500], message: `the daily email (worker output: ${worker.output})` }).toBe(expected);
    return mailsOf(worker)[expected - 1]!;
  };
  const text = fr.admin.deliveryStatus.email.signalements;
  const worker = new Worker(own.databaseUrl, { JOBHUB_TARGET: "e2e", JOBHUB_COMMIT: "beta2000000000000000000000000000000000000", DELIVERY_STATUS_EMAIL_TO: DIGEST_TO });
  try {
    await worker.started();
    const first = await run(1, worker);
    // The new Signalements, by type, in this environment.
    expect(first.text).toContain(text.title);
    expect(first.text).toContain(tr(text.new, { environment: "e2e", types: "" }).trim().split(" ").slice(0, 4).join(" "));
    expect(first.text).toMatch(/3 bugs/);
    expect(first.text).toMatch(/1 idée/);
    expect(first.text).toMatch(/2 questions/);
    // The issues, with their links: A completed by a duplicate and opened, C opened (D was deleted: no link left).
    expect(first.text).toContain(`#${issue.a}`);
    expect(first.text).toContain(issueLink(issue.a));
    expect(first.text).toContain(`#${issue.c}`);
    expect(first.text).toContain(tr(text.issues.opened_other, { count: "2" }));
    expect(first.text).toContain(tr(text.issues.opened_one, { count: "1" }));
    expect(first.text).not.toContain(`#${issue.d}`);
    // « Prêt à clore » with a draft waiting: B and C are ready; none of them has a draft (A's was sent).
    expect(first.text).not.toContain(tr(text.readyWithDraft_other, { count: "1" }));
    // The triage's last pass: its hour.
    expect(first.text).toContain(tr(text.triageRan, { at: "" }).split("{{")[0]!.trim().split(" ").slice(0, 3).join(" "));
    // Numbers and links only: never a word of a Candidate, their name or e-mail.
    for (const forbidden of [ref, "blanche", "Camille", "Durand", camille.email, "Olivia", olivia.email, "devient", "relance"]) expect(first.text, forbidden).not.toContain(forbidden);
    // The Signalement a draft waits on and « Prêt à clore »: B gets one.
    const g = (globalThis as unknown as { __drafts: Record<string, { fr: string; en: string }> }).__drafts;
    expect((await proposeDraft(id.bugB, g.bugA!)).status()).toBe(201);
    const second = await run(2, worker);
    expect(second.text).toContain(tr(text.readyWithDraft_one, { count: "1" }));

    // Why the triage did not happen: no call that day, then an expired key.
    await database.query("UPDATE agent_key SET last_used_at = now() - interval '3 days'");
    await database.query("UPDATE agent_key_call SET at = at - interval '3 days'");
    const noCall = await run(3, worker);
    expect(noCall.text).toContain(tr(text.triageMissed, { reason: text.reasons.no_call }));
    expect(noCall.text).not.toContain(text.triageRan.split("{{")[0]!.trim());
    await database.query("UPDATE agent_key SET expires_at = now() - interval '1 minute'");
    const expired = await run(4, worker);
    expect(expired.text).toContain(tr(text.triageMissed, { reason: text.reasons.key_expired }));
    for (const mail of [noCall, expired]) for (const forbidden of [ref, "Camille", camille.email]) expect(mail.text, forbidden).not.toContain(forbidden);
  } finally {
    await worker.stop();
  }
  // Livraison read GitHub with its read-only token, as before.
  expect(github.calls.filter((call) => call.path.includes("/environments")).every((call) => call.token === STATUS_TOKEN)).toBe(true);
});

test("the Eval Cases of « Données du Candidate dans une issue » are played with the Guardrails: the three blocked, a clean issue let through; the Guardrail is always on", async () => {
  test.setTimeout(240_000);
  const guardrails = fr.admin.guardrails;
  await admin.goto("/admin/garde-fous");
  // Always on: no setting to change, and its Triggers show in the table.
  const issueSection = admin.locator("section#candidate_data_in_issue");
  await expect(issueSection).toBeVisible();
  await expect(issueSection.getByLabel(guardrails.settingLabel)).toHaveCount(0);
  await expect(issueSection).toContainText(guardrails.names.candidate_data_in_issue);
  await expect(admin.getByRole("table", { name: guardrails.triggers.caption }).getByRole("row").filter({ hasText: guardrails.names.candidate_data_in_issue }).first()).toBeVisible();

  // Saving another Guardrail's setting plays every Guardrail's cases first.
  await admin.locator("section#prompt_injection").getByLabel(guardrails.settingLabel).selectOption("flag");
  await admin.locator("section#prompt_injection").getByRole("button", { name: guardrails.saveSetting }).click();
  await expect(main(admin).getByRole("status")).toHaveText(guardrails.notices.settingSaved);
  await admin.getByRole("link", { name: guardrails.runs.played }).click();
  const run = fr.admin.evals.run;
  for (const [title, verdict] of [
    ["Une issue qui cite le message mot pour mot", run.verdicts.block],
    ["Une issue qui nomme la candidate", run.verdicts.block],
    ["Un e-mail ou un téléphone dans les étapes", run.verdicts.block],
    ["Une issue écrite avec ses propres mots", run.verdicts.let_through],
  ] as const) {
    const region = admin.getByRole("region", { name: title });
    await expect(region, title).toContainText(`${verdict} (${run.passed})`);
    await expect(region, title).toContainText(guardrails.names.candidate_data_in_issue);
  }
  // Put back, as the suite found it.
  await admin.goto("/admin/garde-fous");
  await admin.locator("section#prompt_injection").getByLabel(guardrails.settingLabel).selectOption("block");
  await admin.locator("section#prompt_injection").getByRole("button", { name: guardrails.saveSetting }).click();
  await expect(main(admin).getByRole("status")).toHaveText(guardrails.notices.settingSaved);
});

test("the Help Articles of the Back Office, « Signalements » and « Livraison », describe « Prêt à clore », the draft, the link to the issue and the email's section", async () => {
  const article = async (topic: string, slug: string) => {
    await admin.goto(`/admin/aide/${topic}/${slug}`);
    return (await main(admin).innerText()).replace(/\s+/g, " ");
  };
  const signalements = await article("candidats", "page-admin-signalements");
  for (const word of ["Prêt à clore", "brouillon", "issue", "L'équipe Jobbbox", "jamais par le candidat"]) expect(signalements, word).toContain(word);
  const delivery = await article("plateforme", "page-admin-delivery");
  for (const word of ["Signalements", "jamais un texte de candidat", "Prêt à clore", "dernier passage du tri"]) expect(delivery, word).toContain(word);
});

test("the procedure « Trier les signalements » is in docs/agents/issue-tracker.md, and the Release Note fragment is there", () => {
  const procedure = readFileSync("docs/agents/issue-tracker.md", "utf8");
  const section = procedure.slice(procedure.indexOf("## Trier les signalements")).replace(/\s+/g, " ");
  expect(section.length).toBeGreaterThan(500);
  for (const part of [
    "List the queue",
    "« vu »",
    "reproduce it on the Beta",
    "defect of the AI Coach",
    "Eval Case",
    "gap in the help",
    "a reply only",
    "POST /admin/api/signalements/:id/issue",
    "POST /admin/api/signalements/:id/brouillon",
    "\"commentOn\"",
    "Never a Signalement's text in `git`",
    "never kept outside the session",
    "stops the triage: say so",
  ])
    expect(section, part).toContain(part);
  const fragment = readFileSync("packages/help/releases/unreleased/1144.md", "utf8");
  expect(fragment).toMatch(/^---\nkind: (improved|new|fixed)/);
  expect(fragment).toContain("#1141");
  expect(fragment).toMatch(/## fr\n- .+/);
  expect(fragment).toMatch(/## en\n- .+/);
});

test("the issue's link in the Back Office leaves Jobbbox through the Exit Page, like every link out of Jobbbox", async () => {
  for (const [signalement, number] of [[id.bugA, issue.a], [id.bugC, issue.c]] as const) {
    await admin.goto(`/admin/signalements/${signalement}`);
    await expect(admin.locator("[data-issues]").getByRole("link", { name: `#${number}` })).toHaveAttribute("href", exitHref(issueLink(number), "backOffice"));
    await expect(admin.locator("[data-issues]").getByRole("link", { name: `#${number}` })).toHaveAttribute("rel", EXIT_LINK_REL);
  }
});
