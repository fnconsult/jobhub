/**
 * The seeded test stack of the app's Maestro flows (#705, apps/mobile/maestro): the e2e web server, its fakes and its
 * throwaway database (playwright.config.ts), and beside it a small helper the flows and their runner call over HTTP:
 *
 *   POST /candidates                 → 201 { email }  a new Candidate, seeded with MAESTRO_SEED, signed out
 *   GET  /sign-in-code?email=<email> → 200 { code }   the code of the next sign-in email to that address, waited for
 *                                                    (`&timeout=<s>`, 30 s by default; 404 when none came)
 *
 * Each Maestro run takes its own Candidate, so a run never meets another's changes. Everything is invented.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser, Page } from "@playwright/test";
import { legalStepsResponseSchema } from "@jobhub/shared/reads";
import pg from "pg";
import { MAESTRO_SEED } from "../../apps/mobile/maestro/seed";
import { signInWithMagicLink } from "./candidate";
import { codeIn, emailsTo } from "./mailbox";
import { subscribe } from "./plan";

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** A done Job Search's metrics, in the worker's shape (job-search-metrics.spec.ts checks every one in the database does). */
const DONE_SEARCH_METRICS = JSON.stringify({ funnel: { providerUrls: 2, fetched: 2, extracted: 2, alreadyStored: 0, afterDedup: 2, matched: 2 }, skipped: {}, costEur: 0, durationMs: 60_000 });

export type SeededCandidate = { email: string; appliedId: string; interviewId: string; jobSearchId: string };

/** Answers `response`, or says what the seed could not do. */
async function ok<T>(response: Awaited<ReturnType<Page["request"]["post"]>>, what: string): Promise<T> {
  if (!response.ok()) throw new Error(`the Maestro seed could not ${what}: ${response.status()} ${await response.text()}`);
  return (response.status() === 204 ? undefined : await response.json()) as T;
}

/**
 * A new Candidate on Standard, past the legal steps (the CGU accepted, the EU AI Consent given), with MAESTRO_SEED's
 * Profile, Applications, Interview, done Job Search and Free conversation, every date the key screens show on its fixed
 * day; then signed out of the browser that seeded them, so the app signs in afresh, by its code.
 */
export async function seedMaestroCandidate(browser: Browser, origin: string): Promise<SeededCandidate> {
  const email = `maestro.${unique()}@e2e.jobbbox.test`;
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  const headers = { origin };
  try {
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    await ok(await page.request.put("/api/account/eu-ai-consent", { headers }), "give the EU AI Consent");
    const steps = legalStepsResponseSchema.parse(await ok(await page.request.get("/api/account/legal-steps?lang=fr"), "read the legal steps"));
    if (steps.acceptance) {
      await ok(await page.request.post("/api/account/acceptances", { headers, data: { text: "cgu", version: steps.acceptance.version, accepted: true } }), "accept the CGU");
    }

    const { targetRole, location } = MAESTRO_SEED.profile;
    const profile = await ok<{ id: string }>(
      await page.request.post("/api/profiles", {
        headers,
        data: {
          masterCv: { fullName: "Camille Maestro", headline: targetRole, email: "", phone: "", location, summary: "", experience: [], education: [], skills: ["ISO 9001"], languages: [] },
          searchCriteria: { targetRole, locations: [location], contractTypes: ["cdi"] },
        },
      }),
      "create the Profile",
    );
    const offer = async (title: string, employer: string) =>
      (
        await ok<{ id: string }>(
          await page.request.post("/api/job-offers", {
            headers,
            data: { source: { url: `https://offres.exemple.invalid/maestro-${unique()}` }, title, content: `${employer} recrute : ${title}, en CDI, à ${location}. Offre de démonstration.`, employer, location },
          }),
          "create a Job Offer",
        )
      ).id;
    const save = async (jobOfferId: string) => (await ok<{ id: string }>(await page.request.post("/api/applications", { headers, data: { jobOfferId, profileId: profile.id } }), "save an Application")).id;

    const appliedId = await save(await offer(MAESTRO_SEED.applied.title, MAESTRO_SEED.applied.employer));
    await ok(await page.request.patch(`/api/applications/${appliedId}`, { headers, data: { status: "applied" } }), "set « Postulée »");
    const interviewId = await save(await offer(MAESTRO_SEED.interview.title, MAESTRO_SEED.interview.employer));
    await ok(await page.request.patch(`/api/applications/${interviewId}`, { headers, data: { status: "interview" } }), "set « Entretien »");
    const { scheduledAt, durationMinutes, note } = MAESTRO_SEED.interview;
    await ok(await page.request.post(`/api/applications/${interviewId}/interviews`, { headers, data: { scheduledAt, durationMinutes, format: "video", note } }), "add the Interview");
    const found = [];
    for (const title of MAESTRO_SEED.jobOffers) found.push(await offer(title, "Industries Démo"));
    await ok(await page.request.post("/api/coach", { headers, data: { message: MAESTRO_SEED.conversation.title } }), "start the Free conversation");

    const candidateId = ((await (await page.request.get("/api/auth/get-session")).json()) as { user: { id: string } }).user.id;
    const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
    await db.connect();
    try {
      // What the worker leaves behind, which no public endpoint stores without it: SQL on the stack's database.
      const search = await db.query<{ id: string }>(
        "INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at, metrics) VALUES ($1, $2, 'done', $3, $4, $4, $5) RETURNING id",
        [candidateId, profile.id, found, MAESTRO_SEED.day, DONE_SEARCH_METRICS],
      );
      await db.query("UPDATE application SET created_at = $2, status_changed_at = $2 WHERE id = ANY($1)", [[appliedId, interviewId], MAESTRO_SEED.day]);
      await page.request.post("/api/auth/sign-out", { headers });
      return { email, appliedId, interviewId, jobSearchId: search.rows[0]!.id };
    } finally {
      await db.end();
    }
  } finally {
    await context.close();
  }
}

/**
 * The code of the next sign-in email to `email`, after the `seen` first ones: polled in the server's log for `timeoutMs`.
 */
async function nextSignInCode(email: string, seen: number, timeoutMs: number): Promise<{ code: string; count: number } | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const emails = emailsTo(email);
    if (emails.length > seen) return { code: codeIn(emails.at(-1)!), count: emails.length };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/** Starts the helper on `port` (0: any free one). `url` is where the flows reach it. */
export async function startMobileStackHelper(browser: Browser, origin: string, port: number): Promise<{ url: string; server: Server }> {
  /** How many sign-in emails each seeded Candidate had when its last code was served: the next code is a newer one. */
  const served = new Map<string, number>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const answer = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    void (async () => {
      if (request.method === "POST" && url.pathname === "/candidates") {
        const { email } = await seedMaestroCandidate(browser, origin);
        served.set(email, emailsTo(email).length);
        return answer(201, { email });
      }
      const email = url.searchParams.get("email") ?? "";
      if (request.method === "GET" && url.pathname === "/sign-in-code" && served.has(email)) {
        const next = await nextSignInCode(email, served.get(email)!, 1000 * Number(url.searchParams.get("timeout") ?? 30));
        if (!next) return answer(404, { error: "no_sign_in_email" });
        served.set(email, next.count);
        return answer(200, { code: next.code });
      }
      answer(404, { error: "not_found" });
    })().catch((error: unknown) => answer(500, { error: String(error) }));
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}
