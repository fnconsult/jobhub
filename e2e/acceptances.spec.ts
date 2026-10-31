import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { fromNewAddress, requestSignInLink } from "./support/candidate";
import { emailsIn, linkIn, newAddress, waitForEmail } from "./support/mailbox";
import { startServer, type PlanPricesServer } from "./support/plan-prices";

// Issue #510 (ADR-0062): the Acceptances of the CGU. Driven through the public entry points: the sign-in page and the
// emailed link, the Acceptance screen and its HTTP API, the Data export, Account deletion, the worker's nightly purge
// (e2e/support/worker-job.ts) and, for the deletion-reach guard, `vitest` itself.
//
// The registry of Legal Text Versions is read at build (#546): the specs that need CGU versions write fixture versions
// into packages/help/legal/cgu/, rebuild the generated module, start a second server of the app (`next dev`, on the
// suite's database) and restore both afterwards. No fixture is ever committed. In the root-env project, which runs one
// spec at a time (legal-shell.spec.ts writes the same folder). The suite's own server carries no CGU version.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const legalDir = path.resolve("packages/help/legal");
const cguDir = path.join(legalDir, "cgu");
const generated = path.resolve("packages/help/src/legal-texts.generated.ts");
const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
const suiteOrigin = process.env.E2E_WEB_ORIGIN!;

const FIRST = "2025-01-01"; // substantial, the first version
const MINOR = "2025-06-01"; // a correction: asks no one again
const SECOND = "2026-01-01"; // substantial
const dayOnTheBox = (day: string) => day.split("-").reverse().join("/");

const versionFile = (locale: "fr" | "en", effective: string, change: "substantielle" | "mineure") => {
  const front = [
    `title: ${locale === "fr" ? "Conditions générales d'utilisation" : "Terms of use"}`,
    `effective: ${effective}`,
    `change: ${change}`,
    "approved_by: Camille Martin",
    `summary: ${locale === "fr" ? `Résumé de la version ${effective}.` : `Summary of version ${effective}.`}`,
  ].join("\n");
  const body =
    locale === "fr"
      ? `## Objet\nTexte français du ${effective}.\n\n## L'extension sans compte {#invite}\n- Rien n'est gardé.\n`
      : `## Purpose\nEnglish text of ${effective}.\n\n## The extension without an account {#invite}\n- Nothing is kept.\n`;
  return `---\n${front}\n---\n${body}`;
};
const clear = () => {
  rmSync(cguDir, { recursive: true, force: true });
  mkdirSync(cguDir, { recursive: true });
  writeFileSync(path.join(cguDir, ".gitkeep"), "");
};
const sha256 = (day: string) => createHash("sha256").update(readFileSync(path.join(cguDir, `${day}.fr.md`))).digest("hex");

/** Registers exactly these CGU versions (both languages), rebuilds the help package, and starts the app on them. */
async function serveVersions(versions: [string, "substantielle" | "mineure"][]): Promise<PlanPricesServer> {
  clear();
  for (const [day, change] of versions) {
    for (const locale of ["fr", "en"] as const) writeFileSync(path.join(cguDir, `${day}.${locale}.md`), versionFile(locale, day, change));
  }
  const built = spawnSync("npm", ["run", "build", "-w", "@jobhub/help"], { encoding: "utf8" });
  expect(built.status, built.stdout + built.stderr).toBe(0);
  return startServer(510, {}, "dev");
}

/** Signs `email` in on `server` the way a person does: the sign-in page, then the link the server emailed. Returns the page, in a new browser context. */
async function signInOn(browser: Browser, server: PlanPricesServer, email: string): Promise<Page> {
  const already = emailsIn(server.output(), email).length;
  const page = await (await browser.newContext({ baseURL: server.origin, locale: "fr-FR" })).newPage();
  await fromNewAddress(page);
  await page.goto("/connexion", { timeout: 120_000 });
  await requestSignInLink(page, email);
  await expect.poll(() => emailsIn(server.output(), email).length, { message: `sign-in email to ${email}` }).toBeGreaterThan(already);
  await page.goto(linkIn(emailsIn(server.output(), email)[already]!), { timeout: 120_000 });
  return page;
}

type ExportedAcceptance = { text: string; version: string; url: string; sha256: string; channel: string; acceptedAt: string };
const exportOf = async (page: Page) => {
  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  return (await response.json()) as { account: { email: string }; acceptances: ExportedAcceptance[] };
};
const acceptApi = (page: Page, data: unknown) => page.request.post("/api/account/acceptances", { data, headers: { origin: new URL(page.url()).origin } });
const tickAndAccept = async (page: Page, version: string) => {
  const box = page.getByRole("checkbox", { name: fr.acceptance.box.replace("{{date}}", dayOnTheBox(version)) });
  const submit = page.getByRole("button", { name: fr.acceptance.submit });
  await expect(box).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await box.check();
  await submit.click();
};
/** Where accepting brings them: the page they asked for (Mon compte, after sign-in) or home. */
const afterAccepting = (server: PlanPricesServer) => new RegExp(`^${server.origin}/(compte)?$`);
const workerPurge = (hours: number) => {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "acceptances.purge", String(hours)], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, MAIL_TRANSPORT: "console" },
    encoding: "utf8",
  });
  expect(run.status, run.stdout + run.stderr).toBe(0);
};
const rowsOf = async (where: string, ...params: unknown[]) =>
  (await database.query<{ candidate_id: string | null; holder: string; text: string; version: string; channel: string; sha256: string; account_deleted_at: Date | null }>(
    `SELECT * FROM legal_acceptance WHERE ${where} ORDER BY id`,
    params,
  )).rows;

let savedGenerated = "";
test.describe("Acceptances des CGU (#510)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.beforeAll(() => {
    savedGenerated = readFileSync(generated, "utf8");
    clear();
  });
  test.afterAll(async () => {
    clear();
    writeFileSync(generated, savedGenerated);
    await database.end();
  });

  test("with no CGU version registered, signing up is unchanged: no box, no Acceptance, nothing asked", async ({ browser }) => {
    // The suite's own server was built with no CGU version.
    const email = newAddress("accept-none");
    const context = await browser.newContext({ baseURL: suiteOrigin, locale: "fr-FR" });
    const page = await context.newPage();
    await fromNewAddress(page);
    await page.goto("/connexion");
    await requestSignInLink(page, email);
    await page.goto(linkIn(await waitForEmail(email)));
    await expect(page).toHaveURL(`${suiteOrigin}/compte`);
    await page.goto("/acceptation");
    await expect(page).toHaveURL(`${suiteOrigin}/`);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    expect((await exportOf(page)).acceptances).toEqual([]);
    expect((await acceptApi(page, { text: "cgu", version: FIRST, accepted: true })).status()).toBe(409);
    expect(await rowsOf("holder IS NOT NULL AND candidate_id = (SELECT id FROM candidate WHERE email = $1)", email)).toEqual([]);
    await context.close();
  });

  test.describe("with a CGU version registered", () => {
    let server: PlanPricesServer;
    test.beforeAll(async () => {
      server = await serveVersions([[FIRST, "substantielle"]]);
    });
    test.afterAll(() => server?.stop());

    test("a new person must tick the box before going on; the server refuses without it; ticked, one Acceptance is written and the export holds it", async ({ browser }) => {
      const email = newAddress("accept-first");
      const page = await signInOn(browser, server, email);
      await expect(page).toHaveURL(/\/acceptation(\?|$)/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.acceptance.title);
      const link = page.getByRole("link", { name: fr.acceptance.read.replace("{{date}}", dayOnTheBox(FIRST)) });
      await expect(link).toHaveAttribute("href", `/legal/cgu/${FIRST}`);

      // Any other page of theirs sends them back to the screen; Mes données stays open.
      await page.goto("/compte/preferences");
      await expect(page).toHaveURL(/\/acceptation\?/);
      await page.goto("/compte/donnees");
      await expect(page).toHaveURL(/\/compte\/donnees$/);
      // A click from Mes données to another Section of Mon compte is a client-side navigation, which re-renders only
      // what changes: it is sent to the screen too, the gate holds on every page, not only on a full load.
      const accountSection = (name: string) =>
        page.getByRole("navigation", { name: fr.account.sections.sectionsLabel }).first().getByRole("link", { name, exact: true });
      for (const section of [fr.account.sections.preferences, fr.account.sections.profiles]) {
        await page.goto("/compte/donnees");
        await accountSection(section).click();
        await expect(page).toHaveURL(/\/acceptation\?/);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.acceptance.title);
      }
      await page.goto("/acceptation");

      // Server side: without the box, nothing is recorded; a stranger is refused.
      expect((await acceptApi(page, { text: "cgu", version: FIRST, accepted: false })).status()).toBe(400);
      expect((await acceptApi(page, { text: "cgu", version: FIRST })).status()).toBe(400);
      expect((await acceptApi(page, { text: "cgu", version: "2031-01-01", accepted: true })).status()).toBe(409);
      expect((await page.request.post("/api/account/acceptances", { data: { text: "cgu", version: FIRST, accepted: true } })).status()).toBe(403);
      expect((await exportOf(page)).acceptances).toEqual([]);
      const nobody = await browser.newContext({ baseURL: server.origin });
      expect((await nobody.request.post("/api/account/acceptances", { data: { text: "cgu", version: FIRST, accepted: true }, headers: { origin: server.origin } })).status()).toBe(401);
      await nobody.close();

      await tickAndAccept(page, FIRST);
      await expect(page).toHaveURL(afterAccepting(server));
      const exported = await exportOf(page);
      expect(exported.acceptances).toEqual([
        { text: "cgu", version: FIRST, url: `/legal/cgu/${FIRST}`, sha256: sha256(FIRST), channel: "premiere_connexion", acceptedAt: expect.any(String) },
      ]);
      // The proof's pseudonym and Stripe's session never leave in the export.
      const [row, ...others] = await rowsOf("holder = $1", await holderOf(email));
      expect(others).toEqual([]);
      expect(JSON.stringify(exported.acceptances)).not.toContain(row!.holder);
      expect(row).toMatchObject({ text: "cgu", version: FIRST, channel: "premiere_connexion", sha256: sha256(FIRST) });

      // Accepting again changes nothing, and the screen no longer holds them.
      expect((await acceptApi(page, { text: "cgu", version: FIRST, accepted: true })).status()).toBe(204);
      expect((await exportOf(page)).acceptances).toHaveLength(1);
      await page.goto("/compte/preferences");
      await expect(page).toHaveURL(/\/compte\/preferences$/);
      await page.context().close();
    });

    test("after an Account deletion the Acceptance stays, with no email and no name, and the worker purges it at 5 years, never a living Candidate's", async ({ browser }) => {
      const email = newAddress("accept-deleted");
      const page = await signInOn(browser, server, email);
      await tickAndAccept(page, FIRST);
      await expect(page).toHaveURL(afterAccepting(server));
      const holder = await holderOf(email);
      expect(await rowsOf("holder = $1 AND candidate_id IS NOT NULL", holder)).toHaveLength(1);

      const alive = await signInOn(browser, server, newAddress("accept-alive"));
      await tickAndAccept(alive, FIRST);
      await expect(alive).toHaveURL(afterAccepting(server));

      // Deleting is allowed while the screen waits, and takes effect at once.
      const deleted = await page.request.delete("/api/account", { data: { email }, headers: { origin: server.origin } });
      expect(deleted.status(), await deleted.text()).toBe(204);

      const [kept, ...others] = await rowsOf("holder = $1", holder);
      expect(others).toEqual([]);
      expect(kept).toMatchObject({ candidate_id: null, text: "cgu", version: FIRST, channel: "premiere_connexion" });
      expect(kept!.account_deleted_at).toBeInstanceOf(Date);
      expect(Date.now() - kept!.account_deleted_at!.getTime()).toBeLessThan(120_000);
      const whole = JSON.stringify(kept).toLowerCase();
      expect(whole).not.toContain(email.toLowerCase());
      expect(whole).not.toContain(email.split("@")[0]!.toLowerCase());
      expect(kept!.holder).not.toBe(email);

      // The nightly purge: not before 5 years after the deletion, then gone. A living Candidate's row is never purged.
      const aliveRows = async () => (await database.query("SELECT 1 FROM legal_acceptance WHERE candidate_id = (SELECT id FROM candidate WHERE email ~ '^accept-alive\\.')")).rowCount;
      workerPurge(4 * 365 * 24);
      expect(await rowsOf("holder = $1", holder)).toHaveLength(1);
      workerPurge(5 * 366 * 24 + 48);
      expect(await rowsOf("holder = $1", holder)).toEqual([]);
      workerPurge(30 * 366 * 24);
      expect(await aliveRows()).toBeGreaterThan(0);
      await page.context().close();
      await alive.context().close();
    });
  });

  test("a minor version asks no one again; a new substantial one is asked at the next sign-in, once", async ({ browser }) => {
    const email = newAddress("accept-renew");
    let server = await serveVersions([[FIRST, "substantielle"]]);
    try {
      const first = await signInOn(browser, server, email);
      await tickAndAccept(first, FIRST);
      await expect(first).toHaveURL(afterAccepting(server));
      await first.context().close();
    } finally {
      server.stop();
    }

    // A minor correction is a line in the history: the next sign-in goes straight on.
    server = await serveVersions([[FIRST, "substantielle"], [MINOR, "mineure"]]);
    try {
      const minor = await signInOn(browser, server, email);
      await expect(minor).not.toHaveURL(/\/acceptation/);
      await minor.goto("/compte/preferences");
      await expect(minor).toHaveURL(/\/compte\/preferences$/);
      expect((await exportOf(minor)).acceptances.map((a) => a.version)).toEqual([FIRST]);
      await minor.context().close();
    } finally {
      server.stop();
    }

    // A substantial one is asked at the next sign-in, and only the version in effect is accepted.
    server = await serveVersions([[FIRST, "substantielle"], [MINOR, "mineure"], [SECOND, "substantielle"]]);
    try {
      const again = await signInOn(browser, server, email);
      await expect(again).toHaveURL(/\/acceptation(\?|$)/);
      await expect(again.getByRole("checkbox", { name: fr.acceptance.box.replace("{{date}}", dayOnTheBox(SECOND)) })).not.toBeChecked();
      expect((await acceptApi(again, { text: "cgu", version: FIRST, accepted: true })).status()).toBe(409);
      expect((await exportOf(again)).acceptances.map((a) => a.version)).toEqual([FIRST]);
      await tickAndAccept(again, SECOND);
      await expect(again).toHaveURL(afterAccepting(server));
      expect((await exportOf(again)).acceptances.map((a) => [a.version, a.channel])).toEqual([
        [FIRST, "premiere_connexion"],
        [SECOND, "nouvelle_acceptation"],
      ]);
      await again.context().close();

      // Once: the next sign-in after that goes straight on, and nothing more is written.
      const third = await signInOn(browser, server, email);
      await expect(third).not.toHaveURL(/\/acceptation/);
      await third.goto("/compte/preferences");
      await expect(third).toHaveURL(/\/compte\/preferences$/);
      expect((await exportOf(third)).acceptances).toHaveLength(2);
      await third.context().close();
    } finally {
      server.stop();
    }
  });

  test("deletion-reach.test.ts covers the Acceptances table: it passes, and names it", () => {
    const source = readFileSync("apps/web/src/candidate-data/deletion-reach.test.ts", "utf8");
    expect(source).toContain("legal_acceptance");
    const run = spawnSync("npx", ["vitest", "run", "apps/web/src/candidate-data/deletion-reach.test.ts"], {
      env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
      encoding: "utf8",
    });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout + run.stderr).not.toMatch(/skipped/);
  });
});

/** The pseudonym the rows of the person with `email` keep: HMAC-SHA256 of their address under AUTH_SECRET, as the app computes it. */
async function holderOf(email: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  const secret = process.env.AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-only";
  return createHmac("sha256", secret).update(`legal-acceptance:${email.trim().toLowerCase()}`).digest("hex");
}
