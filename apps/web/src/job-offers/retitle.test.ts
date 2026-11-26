import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createProfiles, migrateProfiles } from "../profiles";
import { createJobOffers, migrateJobOffers, type JobOffers } from "./index";
import { retitleJobOffers, type SourcePage } from "./retitle";

const masterCv: MasterCvContent = {
  fullName: "Marc Exemple",
  headline: "Directeur de programme",
  email: "marc@example.fr",
  phone: "",
  location: "Paris",
  summary: "",
  experience: [],
  education: [],
  skills: ["Delivery"],
  languages: [],
};

const TITLE = "Senior Program Director – Delivery Management";
const SLOGAN = "Building tomorrow, together";
const BANNER = `<header><div class="hero"><h1>${SLOGAN}</h1></div></header>`;
const html = (body: string, head = "") => `<html><head><title>Exemple Digital Careers</title>${head}</head><body>${BANNER}${body}</body></html>`;
const jsonLd = (posting: Record<string, unknown>) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", ...posting })}</script>`;

/** The source pages, by URL, as the polite reader would give them. */
const PAGES: Record<string, SourcePage> = {
  "https://careers.exemple-digital.test/jobs/1": { ok: true, html: html(`<main><h1>${TITLE}</h1><p>Vous pilotez la delivery.</p></main>`) },
  "https://careers.exemple-digital.test/jobs/2": { ok: true, html: html(`<main><h1>Rejoignez-nous</h1></main>`, jsonLd({ title: "Directeur de programme" })) },
  "https://careers.exemple-digital.test/jobs/3": { ok: true, html: html(`<main><h1>Chef de projet</h1></main>`) },
  "https://careers.exemple-digital.test/jobs/4": { ok: false, reason: "gone" },
  "https://careers.exemple-digital.test/jobs/5": { ok: true, html: html(`<main><p>Texte seul.</p></main>`) },
  "https://careers.exemple-digital.test/jobs/6": { ok: true, html: `<html><head><meta name="robots" content="noindex"></head><body><main><h1>Autre</h1></main></body></html>` },
};

describe.skipIf(!connectionString)("correcting the titles of the Job Offers already stored (#1128, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let jobOffers: JobOffers;
  let applications: Applications;
  let ids: Record<string, string>;
  const read = async (url: string) => PAGES[url] ?? { ok: false as const, reason: "unreachable" };

  async function capture(n: number, title: string, privateTo?: string) {
    const captured = await jobOffers.capture(
      { source: { url: `https://careers.exemple-digital.test/jobs/${n}` }, title, content: `Offre ${n} chez Exemple Digital.`, employer: "Exemple Digital" },
      "candidate",
      privateTo ? { privateTo } : {},
    );
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    return captured.jobOffer.id;
  }
  const titleOf = async (id: string) => (await database.query<{ title: string }>(`SELECT title FROM job_offer WHERE id = $1`, [id])).rows[0]!.title;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    jobOffers = createJobOffers(database);
    const profiles = createProfiles(database);
    applications = createApplications(database, { jobOffers, profiles });
    const cookie = await signInWithMagicLink(testAuth, "marc@example.fr");
    const marc = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
    ids = {
      slogan: await capture(1, SLOGAN),
      jsonLd: await capture(2, "Rejoignez-nous"),
      right: await capture(3, "Chef de projet"),
      gone: await capture(4, SLOGAN),
      none: await capture(5, SLOGAN),
      noindex: await capture(6, SLOGAN),
    };
    await capture(7, SLOGAN, marc);
    // Marc renamed his Application on the slogan offer: his title is his own.
    const profile = await profiles.create(marc, { masterCv, searchCriteria: { targetRole: "Directeur de programme", locations: ["Paris"] } });
    if (!profile.ok) throw new Error("fixture Profile refused");
    const saved = await applications.save(marc, { jobOfferId: ids.slogan, profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture Application refused");
    await applications.change(marc, saved.application.id, { title: "Mon poste chez Exemple Digital" });
    ids.application = saved.application.id;
    ids.marc = marc;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("lists, in a dry run, the shared Job Offers whose source states another title, and changes nothing", async () => {
    const report = await retitleJobOffers(database, { read, apply: false });

    expect(report).toEqual({
      read: 6,
      applied: false,
      unchanged: 1,
      skipped: { gone: 1, no_stated_title: 1, robots: 1 },
      corrections: [
        { jobOfferId: ids.slogan, sourceUrl: "https://careers.exemple-digital.test/jobs/1", before: SLOGAN, after: TITLE, from: "heading" },
        { jobOfferId: ids.jsonLd, sourceUrl: "https://careers.exemple-digital.test/jobs/2", before: "Rejoignez-nous", after: "Directeur de programme", from: "job_posting" },
      ],
    });
    expect(await titleOf(ids.slogan!)).toBe(SLOGAN);
    expect((await database.query(`SELECT to_regclass('job_offer_title_correction') AS t`)).rows[0].t).toBeNull();
  });

  it("corrects them when applied, keeps what it changed, never a Candidate's own title, and changes nothing more run again", async () => {
    const applied = await retitleJobOffers(database, { read, apply: true });

    expect(applied.corrections).toHaveLength(2);
    expect(await titleOf(ids.slogan!)).toBe(TITLE);
    expect(await titleOf(ids.jsonLd!)).toBe("Directeur de programme");
    expect(await titleOf(ids.gone!)).toBe(SLOGAN);
    // Marc's own title stays his; the Job Offer's own, beside it, is the corrected one.
    expect(await applications.titleOf(ids.marc!, ids.application!)).toMatchObject({ title: "Mon poste chez Exemple Digital", offerTitle: TITLE, renamed: true });
    const { rows } = await database.query(`SELECT job_offer_id, title_before, title_after, stated_by FROM job_offer_title_correction ORDER BY id`);
    expect(rows).toEqual([
      { job_offer_id: ids.slogan, title_before: SLOGAN, title_after: TITLE, stated_by: "heading" },
      { job_offer_id: ids.jsonLd, title_before: "Rejoignez-nous", title_after: "Directeur de programme", stated_by: "job_posting" },
    ]);

    const again = await retitleJobOffers(database, { read, apply: true });
    expect(again).toMatchObject({ corrections: [], unchanged: 3 });
    expect((await database.query(`SELECT count(*)::int AS n FROM job_offer_title_correction`)).rows[0].n).toBe(2);
  });

  it("goes as far as `limit`, oldest first", async () => {
    expect((await retitleJobOffers(database, { read, apply: false, limit: 1 })).corrections.map((each) => each.jobOfferId)).toEqual([ids.slogan]);
  });
});
