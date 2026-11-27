/**
 * #1139 (ADR-0118) — Agent Keys and Signalement triage, end to end, through the public entry points: Paramètres › « Clés d'agent »
 * in the browser (a super-admin only), the Back Office's API over HTTP with `Authorization: Bearer jbx_agent_…`, the Back
 * Office's pages with and without the key, the Back Office Audit, and the secret-blocking hook as a CLI. A server of its own
 * (own database): the keys, the rate limit and the Signalements queue are the spec's alone.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { Pool } from "pg";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { newAddress } from "./support/mailbox";

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const keysText = fr.admin.agentKeys;
const signalementsText = fr.admin.signalements;
const SUPER_ADMIN = "agent-keys-office@e2e.jobbbox.test";
const PORT_OFFSET = 1139;
const PREFIX = "jbx_agent_";
const API = "/admin/api/signalements";
/** The keys of what the queue and `:id` render, in this order (apps/web/src/signalements/triage.ts, TRIAGE_KEYS). */
const EXPECTED_KEYS = ["id", "type", "message", "sentAt", "status", "environment", "version", "device", "interfaceLanguage", "textSize", "path", "attachedQuestion", "attachedCoachReply", "issue", "brouillon"];

let own: OwnServer;
let database: Pool;
let admin: Page;
let anonymous: APIRequestContext;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const tag = () => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const keysTab = "/admin/parametres?tab=cles-agent";
const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });

/** A signed-in page of its own (cookies apart). */
async function signedIn(browser: Browser, email: string, locale = "fr-FR"): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: own.origin, locale })).newPage();
  await signInByEmail(page, own, email);
  return page;
}

/** Creates a key through the form, and returns its value as shown, once. */
async function createKey(name: string, days = "90"): Promise<string> {
  await admin.goto(keysTab);
  await admin.getByLabel(keysText.create.name).fill(name);
  await admin.getByLabel(keysText.create.days).fill(days);
  await admin.getByRole("button", { name: keysText.create.submit }).click();
  const value = await admin.locator("[data-agent-key-value]").inputValue();
  expect(value.startsWith(PREFIX)).toBe(true);
  return value;
}

const get = (value: string | null, path: string, context = anonymous) => context.get(`${own.origin}${path}`, { headers: value ? bearer(value) : {}, maxRedirects: 0 });

test.beforeAll(async ({ browser }) => {
  own = await startOwnServer(PORT_OFFSET, "agent_keys", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    ADMIN_EMAILS: SUPER_ADMIN,
    AUTH_SECRET: "agent-keys-e2e-secret-agent-keys-e2e-secret",
    MAIL_TRANSPORT: "console",
    // The Back Office's Activity pages read the billing configuration (the suite's server has it from its environment).
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

/** What the Signalements of the spec's Candidate say; their Candidate's identity is in the texts the queue must redact. */
const candidate = { email: newAddress("agent-keys-candidate"), name: "Camille Durand-Lefèvre" };
const ref = tag();
let ids: { bug: string; question: string; before: string };
let key: string;

test("a super-admin creates a key (name, scope, 90 days at most): its value is shown once, never in an address; only its SHA-256 is kept", async () => {
  test.setTimeout(240_000);
  await admin.goto(keysTab);
  await expect(admin.getByRole("heading", { name: keysText.create.title })).toBeVisible();
  await expect(admin.getByLabel(keysText.create.scope)).toHaveValue("signalements");
  await expect(admin.getByLabel(keysText.create.days)).toHaveAttribute("max", "90");

  // Beyond 90 days: refused, nothing created (the browser's own check is lifted, to reach the server's).
  await admin.getByLabel(keysText.create.name).fill("triage-beta");
  await admin.getByLabel(keysText.create.days).evaluate((input) => input.removeAttribute("max"));
  await admin.getByLabel(keysText.create.days).fill("91");
  await admin.getByRole("button", { name: keysText.create.submit }).click();
  await expect(admin.getByText(tr(keysText.errors.days_invalid, { max: "90" }))).toBeVisible();
  expect((await database.query("SELECT 1 FROM agent_key")).rowCount).toBe(0);

  // A malformed name: refused.
  await admin.getByLabel(keysText.create.name).evaluate((input) => input.removeAttribute("pattern"));
  await admin.getByLabel(keysText.create.name).fill("Triage Beta");
  await admin.getByLabel(keysText.create.days).fill("90");
  await admin.getByRole("button", { name: keysText.create.submit }).click();
  await expect(admin.getByText(keysText.errors.name_invalid)).toBeVisible();

  // The key.
  const page = await admin.goto(keysTab);
  // The page that shows the form is not cached.
  expect(page!.headers()["cache-control"]).toContain("no-store");
  await admin.getByLabel(keysText.create.name).fill("triage-beta");
  await admin.getByLabel(keysText.create.days).fill("90");
  await admin.getByRole("button", { name: keysText.create.submit }).click();
  const created = admin.locator("[data-agent-key-created]");
  await expect(created).toContainText(tr(keysText.created.title, { name: "triage-beta" }));
  await expect(created).toContainText(keysText.created.once);
  key = await admin.locator("[data-agent-key-value]").inputValue();
  expect(key).toMatch(/^jbx_agent_[A-Za-z0-9_-]{40,}$/);
  // Never in an address (no redirect carried it).
  expect(admin.url()).not.toContain(key);
  expect(admin.url()).not.toContain(PREFIX);

  // Kept: its name, scope, expiry (90 days) and fingerprint; never the value, in any column.
  const { rows } = await database.query("SELECT * FROM agent_key");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: "triage-beta", scope: "signalements", fingerprint: sha256(key), revoked_at: null, last_used_at: null });
  expect(JSON.stringify(rows)).not.toContain(key);
  const days = (rows[0].expires_at.getTime() - rows[0].created_at.getTime()) / 86_400_000;
  expect(days).toBeCloseTo(90, 1);

  // Once: the next visit lists the key without its value, in the page's HTML either.
  await admin.reload();
  await expect(admin.locator("[data-agent-key-value]")).toHaveCount(0);
  await expect(admin.locator("[data-agent-key='triage-beta']")).toContainText(keysText.never);
  await expect(admin.locator("[data-agent-key='triage-beta']")).toContainText(keysText.states.active);
  expect(await admin.content()).not.toContain(key);

  // A name taken is refused.
  await admin.getByLabel(keysText.create.name).fill("triage-beta");
  await admin.getByRole("button", { name: keysText.create.submit }).click();
  await expect(admin.getByText(keysText.errors.name_taken)).toBeVisible();
});

test("« Clés d'agent » is for super-admins: another Administrator gets no tab and no page", async ({ browser }) => {
  const supportEmail = newAddress("agent-keys-support");
  // The account exists first: roles are given to an account.
  const support = await signedIn(browser, supportEmail);
  await admin.goto("/admin/administrateurs");
  await admin.getByLabel(fr.admin.administrators.grantEmail).fill(supportEmail);
  await admin.getByRole("checkbox", { name: fr.admin.roles.support }).check();
  await admin.getByRole("button", { name: fr.admin.administrators.grant }).click();
  await expect(admin.getByRole("status")).toHaveText(tr(fr.admin.administrators.granted, { roles: fr.admin.roles.support }));
  await support.goto("/admin/parametres");
  await expect(support.getByRole("tab", { name: keysText.title })).toHaveCount(0);
  await expect(support.getByRole("link", { name: keysText.title })).toHaveCount(0);
  await support.goto(keysTab);
  await expect(support.getByRole("heading", { name: keysText.create.title })).toHaveCount(0);
  await expect(support.locator("[data-agent-key]")).toHaveCount(0);
  await support.context().close();
});

test("the Back Office Audit keeps the creation by its name, never its value", async () => {
  await admin.goto("/admin/journal?section=agent_keys");
  const row = admin.getByRole("row").filter({ hasText: "triage-beta" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(SUPER_ADMIN);
  await expect(row).toContainText(fr.admin.journal.actions.added);
  expect(await admin.content()).not.toContain(key);
  expect(await admin.content()).not.toContain(sha256(key));
});

test("401 without a key or with an unknown one, on both routes; a session never stands for a key", async () => {
  for (const path of [API, `${API}/00000000-0000-4000-8000-000000000000`]) {
    const without = await get(null, path);
    expect(without.status()).toBe(401);
    expect(without.headers()["www-authenticate"]).toContain("Bearer");
    expect(without.headers()["cache-control"]).toContain("no-store");
    expect((await get(`${PREFIX}${"x".repeat(43)}`, path)).status()).toBe(401);
    expect((await get("not-a-key", path)).status()).toBe(401);
  }
  // An Administrator's session (cookies) opens nothing of it, a super-admin's neither.
  expect((await admin.request.get(`${own.origin}${API}`)).status()).toBe(401);
  expect((await admin.request.post(`${own.origin}${API}/00000000-0000-4000-8000-000000000000/statut`, { data: { statut: "vu" } })).status()).toBe(401);
});

test("the queue renders exactly its fixed keys, redacted, the path without ids, and only the Signalements sent with the AI notice", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await signedIn(browser, candidate.email);
  await database.query("UPDATE candidate SET name = $2, given_name = 'Camille', family_name = 'Durand-Lefèvre' WHERE lower(email) = lower($1)", [candidate.email, candidate.name]);
  const send = async (data: Record<string, unknown>) => {
    const sent = await page.request.post("/api/signalements", { data, headers: { origin: own.origin } });
    expect(sent.status(), await sent.text()).toBe(201);
  };
  const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  // Sent from the form that showed the notice (the web form says so, aiNotice).
  await send({
    type: "bug",
    message: `Je suis ${candidate.name} (${candidate.email}) et le bouton ne répond pas ${ref}`,
    path: `/candidatures/${uuid}`,
    textSize: "large",
    aiNotice: true,
  });
  await send({
    type: "question",
    message: `L'aide ne m'a pas dit comment changer d'offre ${ref}`,
    path: "/compte",
    textSize: "standard",
    attachedQuestion: `Je m'appelle ${candidate.name}, comment passer à l'offre Standard ? ${ref}`,
    attachedCoachReply: `Écrivez à ${candidate.email} ${ref}`,
    aiNotice: true,
  });
  // Sent before the notice existed (or from a form that did not show it): never in the queue.
  await send({ type: "idee", message: `Trier les candidatures par relance ${ref}`, path: "/candidatures", textSize: "standard" });
  await page.context().close();

  const { rows } = await database.query("SELECT id::text, type, ai_notice_shown FROM signalement WHERE message LIKE $1 ORDER BY created_at", [`%${ref}%`]);
  expect(rows.map((row) => [row.type, row.ai_notice_shown])).toEqual([["bug", true], ["question", true], ["idee", false]]);
  ids = { bug: rows[0].id, question: rows[1].id, before: rows[2].id };

  const response = await get(key, API);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["signalements"]);
  const ours = (body.signalements as Record<string, unknown>[]).filter((each) => String(each.message).includes(ref));
  // Exactly the keys planned: the test compares Object.keys.
  expect(ours).toHaveLength(2);
  for (const each of body.signalements) expect(Object.keys(each)).toEqual(EXPECTED_KEYS);
  // The Signalement sent before the notice is never rendered, queue or one.
  expect(body.signalements.map((each: { id: string }) => each.id)).not.toContain(ids.before);
  const outOfScope = await get(key, `${API}/${ids.before}`);
  expect(outOfScope.status()).toBe(404);
  expect(await outOfScope.json()).toEqual({ error: "not_found", reason: "no_ai_notice" });

  const bug = ours.find((each) => each.type === "bug")!;
  const question = ours.find((each) => each.type === "question")!;
  expect(bug).toMatchObject({ id: ids.bug, status: "nouveau", environment: "e2e", interfaceLanguage: "fr", textSize: "large", attachedQuestion: null, attachedCoachReply: null, issue: null, brouillon: null });
  expect(typeof bug.version).toBe("string");
  expect(Number.isNaN(Date.parse(bug.sentAt as string))).toBe(false);
  // Redaction: the Candidate's name and email come out as [NOM] and [E-MAIL].
  expect(bug.message).toBe(`Je suis [NOM] ([E-MAIL]) et le bouton ne répond pas ${ref}`);
  // The path comes out without its id.
  expect(bug.path).toBe("/candidatures/:id");
  expect(question.path).toBe("/compte");
  expect(question.attachedQuestion).toBe(`Je m'appelle [NOM], comment passer à l'offre Standard ? ${ref}`);
  expect(question.attachedCoachReply).toBe(`Écrivez à [E-MAIL] ${ref}`);

  // Never the Candidate's email, name, Plan or id, nor an id of the page's path.
  const text = JSON.stringify(body);
  const candidateId = (await database.query("SELECT id::text FROM candidate WHERE lower(email) = lower($1)", [candidate.email])).rows[0].id;
  for (const forbidden of [candidate.email, "Camille", "Durand", candidateId, uuid, fr.billing.plans.free]) expect(text, forbidden).not.toContain(forbidden);
  for (const forbidden of ["candidateId", "candidate_id", "email", "plan", "reply"]) expect(Object.keys(bug)).not.toContain(forbidden);

  // One, with the same keys.
  const one = await get(key, `${API}/${ids.question}`);
  expect(one.status()).toBe(200);
  const oneBody = await one.json();
  expect(Object.keys(oneBody)).toEqual(["signalement"]);
  expect(Object.keys(oneBody.signalement)).toEqual(EXPECTED_KEYS);
  expect(oneBody.signalement).toEqual(question);
  const unknown = await get(key, `${API}/00000000-0000-4000-8000-000000000000`);
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({ error: "not_found", reason: "unknown" });

  // Filtered by status.
  const withStatus = async (status: string) => ((await (await get(key, `${API}?statut=${status}`)).json()).signalements as { id: string }[]).map((each) => each.id);
  expect(await withStatus("nouveau")).toEqual(expect.arrayContaining([ids.bug, ids.question]));
  expect(await withStatus("traite")).not.toContain(ids.bug);
  expect((await get(key, `${API}?statut=inconnu`)).status()).toBe(400);
});

test("the key only changes a status to « vu », signed key:triage-beta, which the Back Office shows as « vu par triage-beta »", async () => {
  const post = (data: unknown, id = ids.bug) => anonymous.post(`${own.origin}${API}/${id}/statut`, { headers: bearer(key), data });
  for (const refused of ["traite", "nouveau", "", undefined]) expect((await post({ statut: refused })).status(), String(refused)).toBe(400);
  expect((await post({})).status()).toBe(400);
  expect((await anonymous.post(`${own.origin}${API}/${ids.bug}/statut`, { data: { statut: "vu" } })).status()).toBe(401);
  expect((await post({ statut: "vu" }, ids.before)).status()).toBe(404);
  expect((await database.query("SELECT status FROM signalement WHERE id = $1", [ids.bug])).rows[0].status).toBe("nouveau");

  const done = await post({ statut: "vu" });
  expect(done.status()).toBe(200);
  // Its id, status and signature alone, never the message (#1173).
  const answered = await done.json();
  expect(answered).toEqual({ id: ids.bug, statut: "vu", statutMajPar: "key:triage-beta" });
  expect(Object.keys(answered)).toEqual(["id", "statut", "statutMajPar"]);
  expect((await database.query("SELECT status, status_changed_by FROM signalement WHERE id = $1", [ids.bug])).rows[0]).toMatchObject({ status: "vu", status_changed_by: "key:triage-beta" });

  await admin.goto(`/admin/signalements/${ids.bug}`);
  await expect(admin.locator("[data-status-by]")).toHaveText(tr(signalementsText.seenBy, { name: "triage-beta" }));
  await admin.goto("/admin/signalements");
  await expect(admin.getByRole("row").filter({ hasText: tr(signalementsText.seenBy, { name: "triage-beta" }) })).toHaveCount(1);

  // « Traité » is the team's: a Signalement handled is not changed by the key.
  await database.query("UPDATE signalement SET status = 'traite' WHERE id = $1", [ids.question]);
  expect((await post({ statut: "vu" }, ids.question)).status()).toBe(409);
  expect((await database.query("SELECT status FROM signalement WHERE id = $1", [ids.question])).rows[0].status).toBe("traite");
});

/** What the key's own log says of it: how many calls, and its last use. */
const counted = async (name: string) =>
  (await database.query("SELECT (SELECT count(*)::int FROM agent_key_call WHERE agent_key_id = k.id) AS calls, k.last_used_at FROM agent_key k WHERE name = $1", [name])).rows[0] as { calls: number; last_used_at: Date | null };

/** The public route and page a key outside its scope must leave as they are (#1172). */
const PUBLIC = ["/api/health", "/", "/legal/cgu"];

test("outside its scope the key is ignored, never refused (#1172): every route answers as without it, no Back Office page opens through it, nothing is counted", async () => {
  const before = await counted("triage-beta");
  const outside = ["/admin", "/admin/signalements", `/admin/signalements/${ids.bug}`, "/admin/parametres", keysTab, "/admin/api", "/admin/api/signalementsx", "/admin/api/other", "/api/signalements", "/compte", ...PUBLIC];
  for (const path of outside) {
    const [withKey, without] = [await get(key, path), await get(null, path)];
    expect(withKey.status(), path).toBe(without.status());
    expect(withKey.headers()["location"], path).toBe(without.headers()["location"]);
    expect(Boolean(withKey.headers()["set-cookie"]), path).toBe(Boolean(without.headers()["set-cookie"]));
    expect(await withKey.text(), path).not.toContain("out_of_scope");
  }
  // A public route and a public page answer as usual.
  expect((await get(key, "/api/health")).status()).toBe(200);
  for (const page of ["/", "/legal/cgu"]) expect((await get(key, page)).status(), page).toBeLessThan(400);
  // A Back Office page is never opened by the key: an anonymous caller is sent to sign in.
  for (const path of ["/admin/signalements", "/admin/parametres"]) expect((await get(key, path)).status(), path).toBeGreaterThanOrEqual(300);
  const posted = (headers: Record<string, string>) =>
    anonymous.post(`${own.origin}/api/signalements`, { headers: { ...headers, origin: own.origin }, data: { type: "idee", message: "Un message de dix caractères au moins" } });
  expect((await posted(bearer(key))).status()).toBe((await posted({})).status());
  // Beside an Administrator's session, the page answers as to that session alone.
  for (const path of ["/admin/signalements", "/admin/parametres"]) {
    const [withKey, without] = [await admin.request.get(`${own.origin}${path}`, { headers: bearer(key), maxRedirects: 0 }), await admin.request.get(`${own.origin}${path}`, { maxRedirects: 0 })];
    expect(withKey.status(), path).toBe(without.status());
  }
  // Neither its last use nor its journal count a call outside its scope.
  expect(await counted("triage-beta")).toEqual(before);
  // On its own routes, a call sets no cookie.
  expect((await get(key, API)).headers()["set-cookie"]).toBeUndefined();
});

test("Paramètres shows the key's last use and the journal of its calls: the path asked and what was answered, never the content", async () => {
  await admin.goto(keysTab);
  const row = admin.locator("[data-agent-key='triage-beta']");
  await expect(row).not.toContainText(keysText.never);
  await row.getByRole("link", { name: tr(keysText.journal.openLabel, { name: "triage-beta" }) }).click();
  const journal = admin.locator("[data-agent-key-journal]");
  await expect(journal).toContainText(tr(keysText.journal.title, { name: "triage-beta" }));
  await expect(journal).toContainText(`GET ${API}`);
  await expect(journal).toContainText(`POST ${API}/${ids.bug}/statut`);
  await expect(journal).toContainText(keysText.outcomes.allowed);
  expect(await journal.innerText()).not.toContain(ref);
  expect(await journal.innerText()).not.toContain(key);
});

test("the calls are rate limited: past the limit, 429; the journal shows its 50 latest calls, older ones kept only while the limit counts them", async () => {
  const limited = await createKey("rate-test");
  const statuses: number[] = [];
  for (let call = 0; call < 40; call++) statuses.push((await get(limited, API)).status());
  expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
  expect(statuses.slice(30).every((status) => status === 429)).toBe(true);
  const refused = await get(limited, API);
  expect(refused.status()).toBe(429);
  expect(refused.headers()["retry-after"]).toBeTruthy();
  const { rows } = await database.query("SELECT count(*)::int AS n FROM agent_key_call WHERE agent_key_id = (SELECT id FROM agent_key WHERE name = 'rate-test')");
  expect(rows[0].n).toBe(41);
  for (let call = 0; call < 20; call++) await get(limited, API);
  // 30 allowed then 31 refused: the 50 latest, plus the 11 older allowed calls the rate limit still counts (else a flood of
  // refused calls would push them out and let 30 more through).
  const stored = async () =>
    (await database.query("SELECT outcome FROM agent_key_call WHERE agent_key_id = (SELECT id FROM agent_key WHERE name = 'rate-test') ORDER BY id DESC")).rows.map((row) => row.outcome as string);
  const flooded = await stored();
  expect(flooded).toHaveLength(61);
  expect(flooded.slice(50).every((outcome) => outcome === "allowed")).toBe(true);
  expect((await get(limited, API)).status()).toBe(429);
  await admin.goto(keysTab);
  await admin.getByRole("link", { name: tr(keysText.journal.openLabel, { name: "rate-test" }) }).click();
  await expect(admin.locator("[data-agent-key-journal] tbody tr")).toHaveCount(50);
  await expect(admin.locator("[data-agent-key-journal]")).toContainText(keysText.outcomes.rate_limited);
  // Once the window has passed (aged here rather than waited for), the next call is let through and only the 50 latest stay.
  await database.query("UPDATE agent_key_call SET at = at - interval '2 minutes' WHERE agent_key_id = (SELECT id FROM agent_key WHERE name = 'rate-test')");
  expect((await get(limited, API)).status()).toBe(200);
  expect(await stored()).toHaveLength(50);
});

test("an expired key is refused, read afresh from the database at each call", async () => {
  const expiring = await createKey("expiring-key", "1");
  expect((await get(expiring, API)).status()).toBe(200);
  await database.query("UPDATE agent_key SET expires_at = now() - interval '1 minute' WHERE name = 'expiring-key'");
  expect((await get(expiring, API)).status()).toBe(401);
  expect((await get(expiring, `${API}/${ids.bug}`)).status()).toBe(401);
  // Outside its scope, an expired key changes nothing (#1172): answered as without it, not counted.
  const expired = await counted("expiring-key");
  for (const path of PUBLIC) expect((await get(expiring, path)).status(), path).toBe((await get(null, path)).status());
  expect(await counted("expiring-key")).toEqual(expired);
  await admin.goto(keysTab);
  await expect(admin.locator("[data-agent-key='expiring-key']")).toContainText(keysText.states.expired);
  // Still valid for the next one: the same server, no cache.
  expect((await get(key, API)).status()).toBe(200);
});

test("a revoked key is refused at once, and the revocation is in the Back Office Audit by name", async () => {
  expect((await get(key, API)).status()).toBe(200);
  await admin.goto(keysTab);
  await admin.getByRole("button", { name: tr(keysText.revokeLabel, { name: "triage-beta" }) }).click();
  await expect(admin.getByRole("status")).toHaveText(tr(keysText.revoked, { name: "triage-beta" }));
  await expect(admin.locator("[data-agent-key='triage-beta']")).toContainText(tr(keysText.states.revoked, { date: "" }).trim().split(" ")[0]!);
  await expect(admin.getByRole("button", { name: tr(keysText.revokeLabel, { name: "triage-beta" }) })).toHaveCount(0);
  expect(admin.url()).not.toContain(PREFIX);
  for (const path of [API, `${API}/${ids.bug}`]) expect((await get(key, path)).status(), path).toBe(401);
  expect((await anonymous.post(`${own.origin}${API}/${ids.bug}/statut`, { headers: bearer(key), data: { statut: "vu" } })).status()).toBe(401);
  // Outside its scope, a revoked key changes nothing (#1172): answered as without it, not counted.
  const revoked = await counted("triage-beta");
  for (const path of PUBLIC) expect((await get(key, path)).status(), path).toBe((await get(null, path)).status());
  expect(await counted("triage-beta")).toEqual(revoked);
  // Its calls are still in its journal, refused as « révoquée ».
  await admin.getByRole("link", { name: tr(keysText.journal.openLabel, { name: "triage-beta" }) }).click();
  await expect(admin.locator("[data-agent-key-journal]")).toContainText(keysText.outcomes.revoked);

  await admin.goto("/admin/journal?section=agent_keys");
  const entries = admin.getByRole("row").filter({ hasText: "triage-beta" });
  await expect(entries).toHaveCount(2);
  await expect(entries.filter({ hasText: fr.admin.journal.actions.added })).toHaveCount(1);
  await expect(entries.filter({ hasText: fr.admin.journal.actions.revoked })).toHaveCount(1);
  const content = await admin.content();
  for (const secret of [key, sha256(key)]) expect(content).not.toContain(secret);
  const audit = JSON.stringify((await database.query("SELECT * FROM back_office_audit").catch(() => ({ rows: [] }))).rows);
  expect(audit).not.toContain(key);
  expect(audit).not.toContain(sha256(key));
});

test("the form of a Signalement shows the AI notice under its field, and the Signalement keeps that it was shown (web, French and English)", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const [locale, text] of [["fr-FR", fr.signalement.aiNotice], ["en-US", en.signalement.aiNotice]] as const) {
    const email = newAddress(`agent-keys-form-${locale.slice(0, 2)}`);
    const page = await signedIn(browser, email, locale);
    if (locale === "en-US") {
      const switched = await page.request.post("/api/auth/update-user", { data: { interfaceLanguage: "en" }, headers: { origin: own.origin } });
      expect(switched.ok(), await switched.text()).toBe(true);
    }
    await page.goto("/candidatures");
    await page.getByRole("button", { name: (locale === "fr-FR" ? fr : en).signalement.open, exact: true }).click();
    const form = page.getByRole("complementary", { name: (locale === "fr-FR" ? fr : en).signalement.title });
    await expect(form.locator(".signalement-ai-notice")).toHaveText(text);
    // Under the field.
    const [field, notice] = [(await form.getByRole("textbox").boundingBox())!, (await form.locator(".signalement-ai-notice").boundingBox())!];
    expect(notice.y).toBeGreaterThanOrEqual(field.y + field.height - 1);
    await form.getByRole("textbox").fill(`Un message envoyé depuis le formulaire ${locale} ${ref}`);
    await form.getByRole("button", { name: (locale === "fr-FR" ? fr : en).signalement.send, exact: true }).click();
    await expect.poll(async () => (await database.query("SELECT ai_notice_shown FROM signalement WHERE message LIKE $1", [`%${locale} ${ref}`])).rows[0]?.ai_notice_shown).toBe(true);
    await page.context().close();
  }
  expect(fr.signalement.aiNotice).toBe("Un outil d'IA peut lire votre message pour nous aider à le traiter.");
  expect(en.signalement.aiNotice).toBe("An AI tool may read your message to help us handle it.");
});

test("the hook that blocks secrets knows the key's prefix", () => {
  const run = (command: string) => execFileSync("node", ["scripts/hooks/no-secrets.mjs"], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), encoding: "utf8" });
  const denied = JSON.parse(run(`curl -H "Authorization: Bearer ${key}" ${own.origin}${API}`));
  expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(run(`curl -H "Authorization: Bearer $JOBBBOX_AGENT_KEY" ${own.origin}${API}`)).toBe("");
});
