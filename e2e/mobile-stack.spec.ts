import { existsSync, writeFileSync } from "node:fs";
import { API_CLIENT_HEADER, API_VERSION, API_VERSION_HEADER, MOBILE_CLIENT } from "@jobhub/shared";
import { agendaResponseSchema, applicationResponseSchema, applicationsResponseSchema, coachConversationsResponseSchema, jobSearchResponseSchema, jobSearchesResponseSchema, offerBoxResponseSchema } from "@jobhub/shared/reads";
import { expect, test } from "@playwright/test";
import { MAESTRO_SEED } from "../apps/mobile/maestro/seed";
import { startMobileStackHelper } from "./support/mobile-stack";

// The seeded test stack of the app's Maestro flows (#705, docs/ops/mobile.md): its helper seeds a Candidate per run and
// hands the flows the code of their sign-in email. Run in the e2e suite, it is checked as the app and the flows use it;
// with MOBILE_STACK_READY, the `mobile-e2e` workflow holds it open while Maestro runs (apps/mobile/maestro/run.ts).
const origin = process.env.E2E_WEB_ORIGIN!;
const APP = { [API_CLIENT_HEADER]: MOBILE_CLIENT, [API_VERSION_HEADER]: String(API_VERSION) };

test("seeds a Candidate per run, whom the app signs in by the code the helper hands the flows", async ({ browser }) => {
  test.setTimeout(120_000);
  const helper = await startMobileStackHelper(browser, origin, 0);
  try {
    const created = await fetch(`${helper.url}/candidates`, { method: "POST" });
    expect(created.status, await created.clone().text()).toBe(201);
    const { email } = (await created.json()) as { email: string };
    const other = (await (await fetch(`${helper.url}/candidates`, { method: "POST" })).json()) as { email: string };
    expect(other.email).not.toBe(email);

    // As the app does (src/session/app-session.ts): its sign-in email asked, then its code typed (#686).
    const app = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.70.5.1" } });
    const asked = await app.request.post("/api/auth/sign-in/magic-link", { headers: APP, data: { email, callbackURL: "jobbbox://connexion/app" } });
    expect(asked.ok(), await asked.text()).toBe(true);
    const answered = await fetch(`${helper.url}/sign-in-code?email=${encodeURIComponent(email)}`);
    expect(answered.status).toBe(200);
    const { code } = (await answered.json()) as { code: string };
    const signedIn = await app.request.post("/api/auth/sign-in/email-otp", { headers: APP, data: { email, otp: code } });
    expect(signedIn.ok(), await signedIn.text()).toBe(true);

    const read = async <T>(path: string, schema: { parse: (value: unknown) => T }) => {
      const response = await app.request.get(path, { headers: APP });
      expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
      return schema.parse(await response.json());
    };
    const { applications } = await read("/api/applications", applicationsResponseSchema);
    // In the seed's order, every run: the key screen « candidatures » is compared with its capture.
    expect(applications.map(({ title }) => title)).toEqual([MAESTRO_SEED.applied.title, MAESTRO_SEED.interview.title]);
    const byTitle = Object.fromEntries(applications.map((application) => [application.title, application]));
    expect(byTitle[MAESTRO_SEED.applied.title]).toMatchObject({ employer: MAESTRO_SEED.applied.employer, status: "applied" });
    expect(byTitle[MAESTRO_SEED.interview.title]).toMatchObject({ employer: MAESTRO_SEED.interview.employer, status: "interview" });

    const applied = await read(`/api/applications/${byTitle[MAESTRO_SEED.applied.title]!.id}`, applicationResponseSchema);
    expect(applied.createdAt).toBe(new Date(MAESTRO_SEED.day).toISOString());
    expect(applied.jobOffer.location).toBe(MAESTRO_SEED.profile.location);
    const interview = await read(`/api/applications/${byTitle[MAESTRO_SEED.interview.title]!.id}`, applicationResponseSchema);
    expect(interview.interviews).toEqual([expect.objectContaining({ durationMinutes: MAESTRO_SEED.interview.durationMinutes, note: MAESTRO_SEED.interview.note })]);

    const agenda = await read("/api/agenda", agendaResponseSchema);
    expect(JSON.stringify(agenda)).toContain(MAESTRO_SEED.interview.title);

    const conversations = await read("/api/coach/conversations", coachConversationsResponseSchema);
    expect(JSON.stringify(conversations)).toContain(MAESTRO_SEED.conversation.title);

    const { profiles } = await read("/api/job-searches", jobSearchesResponseSchema);
    expect(profiles.map(({ profile, searches }) => [profile.name, searches.map(({ status, found }) => [status, found])])).toEqual([
      [expect.any(String), [["done", MAESTRO_SEED.jobOffers.length]]],
    ]);
    const search = await read(`/api/job-searches/${profiles[0]!.searches[0]!.id}`, jobSearchResponseSchema);
    expect(JSON.stringify(search)).toContain(MAESTRO_SEED.jobOffers[0]);
    expect(JSON.stringify(search)).toContain(MAESTRO_SEED.jobOffers[1]);
    // Recherches d'offres opens on the Offer box (ADR-0090): the Job Search's Job Offers there, à traiter, for its Profile,
    // as its report leaves them, on the seeded day and in the seed's order, so « Suivre » is offered on the first and the
    // capture shows them the same each run.
    const box = await read("/api/offer-box", offerBoxResponseSchema);
    expect(box.toHandle).toBe(MAESTRO_SEED.jobOffers.length);
    expect(box.entries.map(({ jobOffer, state, sources, arrivalDay, scoredWith }) => [[jobOffer.title, jobOffer.employer].join(" · "), state, sources.map(({ source }) => source), arrivalDay, scoredWith?.id])).toEqual(
      MAESTRO_SEED.jobOfferRows.map((row) => [row, "to_handle", ["job_search"], MAESTRO_SEED.day.slice(0, 10), profiles[0]!.profile.id]),
    );

    // A code is handed once: the next one is that of a newer email.
    const again = await fetch(`${helper.url}/sign-in-code?email=${encodeURIComponent(email)}&timeout=1`);
    expect(again.status).toBe(404);
    // Only to a seeded Candidate.
    expect((await fetch(`${helper.url}/sign-in-code?email=${encodeURIComponent("someone@example.fr")}`)).status).toBe(404);
    await app.close();
  } finally {
    helper.server.close();
  }
});

test("holds the stack open for the Maestro runs, until they are done (MOBILE_STACK_READY)", async ({ browser }) => {
  const ready = process.env.MOBILE_STACK_READY;
  test.skip(!ready, "only in the mobile-e2e workflow, which runs Maestro beside it");
  test.setTimeout(0);
  const helper = await startMobileStackHelper(browser, origin, Number(process.env.MOBILE_STACK_PORT ?? 0));
  try {
    writeFileSync(ready!, JSON.stringify({ helper: helper.url, origin }));
    const done = `${ready}.done`;
    while (!existsSync(done)) await new Promise((resolve) => setTimeout(resolve, 1000));
  } finally {
    helper.server.close();
  }
});
