import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { docxCv, MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { derivedPort } from "./support/ports";

// Issue #72: an invalid AI configuration (here MISTRAL_API_KEY unset, though every
// task routes to Mistral) must not break reading a CV. POST /api/cv/draft falls
// back to the rule-based reader for a signed-in Candidate, with one warning naming
// the missing setting; a Guest's draft never builds the AI layer; refusing a bad
// file (CvFileError) is unchanged. Checked on a second build of the app started
// without the key, on the suite's database (the Candidate's session carries over).
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const WARNING = "[cv] AI reading of a CV failed";
const pdfFile = (lines: string[] = MARIE_DUPONT_CV) => ({ name: "CV Marie Dupont.pdf", mimeType: PDF, buffer: Buffer.from(pdfCv(lines)) });

async function startServerWithoutMistralKey() {
  const port = derivedPort(820);
  const serverOrigin = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  delete env.MISTRAL_API_KEY;
  delete env.AI_FAKE;
  Object.assign(env, {
    DATABASE_URL: process.env.E2E_DATABASE_URL,
    APP_URL: serverOrigin,
    AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-only",
    MAIL_TRANSPORT: "console",
    AI_SCORING_PROVIDER: "mistral",
    AI_WRITING_PROVIDER: "mistral",
    AI_COACHING_PROVIDER: "mistral",
    AI_CV_PARSING_PROVIDER: "mistral",
    AI_OFFER_ANALYSIS_PROVIDER: "mistral",
    PERPLEXITY_API_KEY: "e2e-perplexity-key",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    // Mistral stays faked: should anything reach it despite the missing key, the reading would not be rule-based.
    NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-mistral.mjs")}`,
  });
  let output = "";
  const child: ChildProcess = spawn("npx", ["next", "start", "apps/web", "-p", String(port)], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  const stop = () => {
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      // already gone
    }
  };
  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error(`web app exited (${child.exitCode}):\n${output}`);
          return fetch(`${serverOrigin}/api/health`).then((r) => r.status, () => 0);
        },
        { timeout: 90_000, message: "web app answers /api/health" },
      )
      .toBe(200);
  } catch (error) {
    stop();
    throw error;
  }
  return { origin: serverOrigin, stop, output: () => output };
}

const warningsIn = (log: string) => log.split("\n").filter((line) => line.includes(WARNING));

test.describe("drafting from a CV when the AI configuration is invalid", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  let server: Awaited<ReturnType<typeof startServerWithoutMistralKey>>;
  test.beforeAll(async () => {
    server = await startServerWithoutMistralKey();
  });
  test.afterAll(() => server?.stop());

  test("a Guest's CV is read by rules without building the AI layer: 200, no warning", async ({ request }) => {
    const before = warningsIn(server.output()).length;

    for (const cv of [pdfFile(), { name: "cv.docx", mimeType: DOCX, buffer: Buffer.from(await docxCv(MARIE_DUPONT_CV)) }]) {
      const response = await request.post(`${server.origin}/api/cv/draft`, { headers: { origin: server.origin }, multipart: { cv } });
      expect(response.status(), await response.text()).toBe(200);
      const draft = await response.json();
      expect(draft.masterCv.fullName).toBe("Marie Dupont");
      expect(draft.searchCriteria).toEqual({ targetRole: "Directrice financière", location: "Lyon (69003)" });
    }

    expect(warningsIn(server.output()).length - before).toBe(0);
    expect(server.output()).not.toContain("MISTRAL_API_KEY");
  });

  test("a signed-in Candidate's CV falls back to the rule-based draft, with one warning naming the missing setting", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-config"));
    // The Candidate's session carries over to the second server (same AUTH_SECRET, localhost cookies span ports):
    // only a Candidate's CV is offered to the AI layer, so the warning below shows they were recognised.
    const before = warningsIn(server.output()).length;

    const response = await page.request.post(`${server.origin}/api/cv/draft`, { headers: { origin: server.origin }, multipart: { cv: pdfFile() } });

    expect(response.status(), await response.text()).toBe(200);
    const draft = await response.json();
    expect(draft.masterCv).toMatchObject({ fullName: "Marie Dupont", skills: ["Consolidation", "IFRS", "SAP", "Management d'équipe"] });
    expect(draft.masterCv.experience).toHaveLength(2);
    expect(draft.searchCriteria).toEqual({ targetRole: "Directrice financière", location: "Lyon (69003)" });
    await expect.poll(() => warningsIn(server.output()).length - before).toBe(1);
    const [warning] = warningsIn(server.output()).slice(before);
    expect(warning).toContain("MISTRAL_API_KEY");
    expect(warning).not.toContain("e2e-perplexity-key");

    // Saving that draft as a Profile works like any other draft.
    const created = await page.request.post(`${server.origin}/api/profiles`, { headers: { origin: server.origin }, data: draft });
    expect(created.status(), await created.text()).toBe(201);
  });

  test("bad files are still refused with their CvFileError code (400), for a Candidate and a Guest alike", async ({ page, request }) => {
    await signInWithMagicLink(page, newAddress("ai-config-files"));
    const before = warningsIn(server.output()).length;
    const cases = [
      { cv: { name: "photo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }, error: "unsupported_format" },
      { cv: { name: "cv.pdf", mimeType: PDF, buffer: Buffer.from(pdfCv(MARIE_DUPONT_CV).slice(0, 40)) }, error: "unreadable" },
      { cv: { name: "scan.pdf", mimeType: PDF, buffer: Buffer.from(pdfCv([])) }, error: "empty" },
    ];

    for (const client of [page.request, request]) {
      for (const { cv, error } of cases) {
        const response = await client.post(`${server.origin}/api/cv/draft`, { headers: { origin: server.origin }, multipart: { cv } });
        expect(response.status(), `${cv.name}: ${await response.text()}`).toBe(400);
        expect(await response.json()).toEqual({ error });
      }
      const noFile = await client.post(`${server.origin}/api/cv/draft`, { headers: { origin: server.origin }, multipart: { other: "x" } });
      expect(noFile.status()).toBe(400);
      expect(await noFile.json()).toEqual({ error: "unsupported_format" });
    }

    expect(warningsIn(server.output()).length - before).toBe(0);
    expect(server.output()).not.toMatch(/Une erreur est survenue|⨯/);
  });
});
