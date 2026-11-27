import { spawnSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../apps/web/src/billing/fake-stripe";
import type { HarnessResult, Scenario } from "./support/coach-actions-harness";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #1157 (ADR-0119 D1): a company outside the Candidate's Applications goes through the Target Companies of one of
// their Profiles, as Coach Actions. Driven through the public entry points: POST /api/coach (the Coach Panel's route), the
// faked AI Coach calling the Coach Action a message names (`E2E_COACH_TOOL=<name>:<json>`, fake-mistral.mjs), the
// conversation's cards in the browser (« Appliquer », « Mettre à jour »), the routes and pages the cards go through, and the AI
// Coach's Eval Cases played as an Eval Run plays them (support/coach-actions-harness.ts). Three acceptance criteria:
//  1. « des contacts chez Exemple Industrie » with no Application gives the card `propose_target_company`; for an existing
//     Target Company, the contact search, or the dossier's build while it is not built;
//  2. a Plan that is not Premium, or no contact provider: one sentence and a Typed redirect, never a card;
//  3. a name the company register lists as a sole trader's (a private person's) is refused with its reason (ADR-0007).
// COACH_ACTIONS_ENABLED is on for this spec's servers only; the register, the contact-data provider (Apollo) and Stripe are
// faked. A second server has no contact provider.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 1157;
const NO_PROVIDER_PORT_OFFSET = 1257;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const APPLIED = new RegExp(`^${tr(texts.applied, { time: "\\d\\d:\\d\\d" })}$`);

const masterCv = {
  fullName: "Inès Moreau",
  headline: "Data analyst",
  email: "ines.moreau@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["SQL"],
  languages: [],
};

const serverEnv = (): NodeJS.ProcessEnv => ({
  JOBHUB_TARGET: "e2e",
  JOBHUB_IGNORE_ROOT_ENV: "1",
  AUTH_SECRET: "e2e-coach-target-companies-e2e-coach-target-comp",
  MAIL_TRANSPORT: "console",
  AI_SCORING_PROVIDER: "mistral",
  AI_WRITING_PROVIDER: "mistral",
  AI_COACHING_PROVIDER: "mistral",
  AI_CV_PARSING_PROVIDER: "mistral",
  AI_OFFER_ANALYSIS_PROVIDER: "mistral",
  AI_OFFER_EMAIL_READING_PROVIDER: "mistral",
  MISTRAL_API_KEY: "e2e-mistral-key",
  PERPLEXITY_API_KEY: "e2e-perplexity-key",
  STRIPE_SECRET_KEY: "sk_test_fake",
  STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
  STRIPE_PRICE_STANDARD: "price_standard_monthly",
  STRIPE_PRICE_PREMIUM: "price_premium_monthly",
  STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
  STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
  STRIPE_API_URL: process.env.E2E_STRIPE_URL,
  COACH_ACTIONS_ENABLED: "true",
  NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs", "fake-company-sources.mjs", "fake-contact-provider.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
});

let server: OwnServer;
let withoutProvider: OwnServer;

async function query<T extends pg.QueryResultRow>(on: OwnServer, sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: on.databaseUrl });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

type Candidate = { page: Page; profileId: string; profileName: string; on: OwnServer };

/** A new Candidate on `on`, signed in on a wide screen, with a Profile; on Premium when asked, through Stripe's signed webhook. */
async function newCandidate(browser: Browser, { premium, on = server }: { premium: boolean; on?: OwnServer }): Promise<Candidate> {
  const context = await browser.newContext({ baseURL: on.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const email = newAddress("coach-1157");
  await signInByEmail(page, on, email);
  const headers = { origin: on.origin };
  if (premium) {
    const checkout = await page.request.post("/api/billing/checkout", { form: { plan: "premium" }, headers, maxRedirects: 0 });
    expect(checkout.status()).toBe(303);
    const { payload, signature } = signedEvent(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(email), price: FAKE_STRIPE_PRICES.premium, status: "active" }));
    const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
    expect(delivered.status()).toBe(200);
  }
  const created = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Data analyst", locations: ["Lyon"] } }, headers });
  expect(created.status(), await created.text()).toBe(201);
  const profileId = (await created.json()).id as string;
  const [profile] = await query<{ name: string }>(on, "SELECT name FROM profile WHERE id = $1", [profileId]);
  return { page, profileId, profileName: profile!.name, on };
}

/** A company added to the Profile's Target Companies as the Section's own form adds it: the route. */
async function addByTheSection({ page, profileId, on }: Candidate, name: string) {
  const added = await page.request.post(`/api/profiles/${profileId}/target-companies`, { data: { name }, headers: { origin: on.origin } });
  expect(added.status(), await added.text()).toBe(201);
}

interface Asked {
  conversation: { id: string };
  reply: string;
  cards?: { id: string; status: string; change: { what: string; target: { kind: string; id: string; name: string; href: string }; fields?: { name: string }[]; also?: unknown[]; quota?: { label: string; prompt?: unknown } } }[];
  redirect?: { page: string; section?: string | null; object?: string | null; href: string };
}

/**
 * What the Candidate sends the AI Coach through the Coach Panel's route, having it call the Coach Actions `tools` in turn; with
 * `say`, the sentence it writes once they are called (E2E_COACH_SAY_AFTER). Without it, the reply echoes the last result.
 */
async function ask({ page, on }: Candidate, message: string, tools: [string, object][], say?: string): Promise<Asked> {
  const lines = [message, ...tools.map(([name, args]) => `E2E_COACH_TOOL=${name}:${JSON.stringify(args)}`), ...(say ? [`E2E_COACH_SAY_AFTER=${say}`] : [])];
  const asked = await page.request.post("/api/coach", { headers: { origin: on.origin }, data: { message: lines.join("\n") } });
  expect(asked.status(), await asked.text()).toBe(200);
  return (await asked.json()) as Asked;
}

const cardOf = (page: Page, what: string | RegExp) => page.getByRole("region", { name: fr.conversationFirst.label }).getByRole("article", { name: what });
const targetCompaniesOf = (on: OwnServer, profileId: string) =>
  query<{ id: string; name: string; company_key: string; origin: string; spontaneous_application_id: string | null }>(
    on,
    "SELECT id, name, company_key, origin, spontaneous_application_id FROM target_company WHERE profile_id = $1 AND set_aside_at IS NULL ORDER BY added_at",
    [profileId],
  );

/** The Target Company `name`'s id, as the AI Coach reads it (read_target_companies). */
async function idOfRead(candidate: Candidate, name: string): Promise<string> {
  const { reply } = await ask(candidate, "Quelles sont mes entreprises cibles ?", [["read_target_companies", { profileId: candidate.profileId }]]);
  const found = new RegExp(`entreprise cible \\(id ([0-9a-f-]{36})\\) ${name}`).exec(reply);
  expect(found, reply).toBeTruthy();
  return found![1]!;
}

test.describe.configure({ mode: "serial" });

test.describe("the AI Coach and a company outside the Applications: the Target Companies as Coach Actions (#1157)", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    server = await startOwnServer(PORT_OFFSET, "coach_target_companies", {
      ...serverEnv(),
      CONTACT_ENRICHMENT_PROVIDER: "apollo",
      APOLLO_API_KEY: "e2e-apollo-key",
      CONTACT_ENRICHMENT_DPA_SIGNED: "true",
    });
    // No contact-data provider at all: no key, no provider named.
    withoutProvider = await startOwnServer(NO_PROVIDER_PORT_OFFSET, "coach_target_companies_no_provider", {
      ...serverEnv(),
      CONTACT_ENRICHMENT_PROVIDER: "",
      APOLLO_API_KEY: "",
      LUSHA_API_KEY: "",
      KASPR_API_KEY: "",
    });
  });

  test.afterAll(async () => {
    await server?.stop();
    await withoutProvider?.stop();
  });

  // --------------------------------------------------------------------------------------------- Eval Cases (criterion 1)

  test("Eval Cases « des contacts chez Exemple Industrie »: no Application and no Target Company gives the card propose_target_company; the same request for an existing Target Company gives the contact search, or the dossier's build while it is not built", () => {
    const marker = (name: string, args: unknown) => `${name}:${JSON.stringify(args)}`;
    const scenario: Scenario = {
      settings: { enabled: true, maxRounds: 2 },
      shipped: true,
      replies: [],
      evalCases: [
        { id: "target-company-contacts-add", scripted: marker("propose_target_company", { name: "Exemple Industrie" }) },
        { id: "target-company-contacts-search", scripted: marker("propose_target_contact_search", { targetCompanyId: "t-industrie" }) },
        { id: "target-company-contacts-dossier-first", scripted: marker("propose_target_company_dossier", { targetCompanyId: "t-industrie" }) },
        { id: "target-company-spontaneous-application", scripted: marker("propose_spontaneous_application", { targetCompanyId: "t-industrie" }) },
        // Not scripted: what the AI Coach is told and offered.
        { id: "target-company-contacts-add" },
      ],
    };
    const harness = path.resolve("e2e/support/coach-actions-harness.ts");
    const result = spawnSync(path.resolve("node_modules/.bin/tsx"), [harness, JSON.stringify(scenario)], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_NO_WARNINGS: "1" },
      encoding: "utf8",
      timeout: 90_000,
    });
    const line = result.stdout.split("\n").find((each) => each.startsWith("COACH_ACTIONS_RESULT "));
    if (!line) throw new Error(`Coach Actions harness failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
    const r = JSON.parse(line.slice("COACH_ACTIONS_RESULT ".length)) as HarnessResult;

    const [add, search, dossier, spontaneous, plain] = r.evals;
    expect(add).toMatchObject({ id: "target-company-contacts-add", proposals: 1, proposed: [{ action: "propose_target_company", data: { name: "Exemple Industrie" } }] });
    expect(search).toMatchObject({ proposals: 1, proposed: [{ action: "propose_target_contact_search", data: { targetCompanyId: "t-industrie" } }] });
    expect(dossier).toMatchObject({ proposals: 1, proposed: [{ action: "propose_target_company_dossier", data: { targetCompanyId: "t-industrie" } }] });
    expect(spontaneous).toMatchObject({ proposals: 1, proposed: [{ action: "propose_spontaneous_application", data: { targetCompanyId: "t-industrie" } }] });
    // The five Coach Actions are offered, and the rules say a company outside the Applications passes through them, never a page.
    for (const each of [add, search, dossier, spontaneous]) {
      expect(each!.offered).toEqual(expect.arrayContaining(["read_target_companies", "propose_target_company", "propose_target_company_dossier", "propose_target_contact_search", "propose_spontaneous_application"]));
    }
    expect(plain!.system).toContain("Une entreprise chez qui le candidat n'a aucune candidature passe par les entreprises cibles");
    expect(plain!.system).toContain("Ne le renvoie jamais vers la page des entreprises cibles");
    expect(r.externalApi).toEqual([]);
  });

  // ------------------------------------------------------------------------------ the card to add (criterion 1, live)

  test("« des contacts chez Exemple Industrie », no Application there: the card « Entreprise cible » names the Profile, its name editable; nothing is added until « Appliquer »", async ({ browser }) => {
    const candidate = await newCandidate(browser, { premium: true });
    const { page, profileId, profileName, on } = candidate;

    const asked = await ask(candidate, "Trouve-moi des contacts chez Exemple Industrie, à Lyon.", [["propose_target_company", { profileId, name: "Exemple Industrie" }]]);
    expect(asked.cards).toHaveLength(1);
    expect(asked.cards![0]).toMatchObject({ status: "pending", change: { what: texts.fields.targetCompany, target: { kind: "profile", id: profileId, name: tr(texts.profileName, { name: profileName }) } } });
    expect(asked.cards![0]!.change.fields).toEqual([expect.objectContaining({ name: "name" })]);
    // Proposed: nothing added, and no link to a page in the reply.
    expect(await targetCompaniesOf(on, profileId)).toEqual([]);
    expect(asked.redirect).toBeUndefined();

    await page.goto(`/conversations/${asked.conversation.id}`);
    const card = cardOf(page, texts.fields.targetCompany);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(texts.by);
    await expect(card.getByRole("link", { name: tr(texts.profileName, { name: profileName }) })).toHaveAttribute("href", `/profils/${profileId}/entreprises-cibles`);
    await expect(card).toContainText(tr(texts.values.notTargetCompany, { profile: profileName }));
    await expect(card).toContainText(tr(texts.values.targetCompanyAdded, { company: "Exemple Industrie", profile: profileName }));
    await expect(card.getByRole("button")).toHaveText([texts.apply, texts.edit, texts.dismiss]);

    await card.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(card.getByRole("status")).toHaveText(APPLIED);
    expect(await targetCompaniesOf(on, profileId)).toEqual([expect.objectContaining({ name: "Exemple Industrie", origin: "candidate", spontaneous_application_id: null })]);
    // On the Section, where the Candidate would have added it themselves.
    await page.goto(`/profils/${profileId}/entreprises-cibles`);
    await expect(page.getByRole("heading", { name: "Exemple Industrie" })).toBeVisible();
  });

  // ------------------------------------------------------------ an existing Target Company (criterion 1, live)

  test("the same request for an existing Target Company: not added twice; its dossier's build proposed while it is not built, then its contact search; « Mettre à jour » builds the dossier, « Appliquer » finds the people", async ({ browser }) => {
    const candidate = await newCandidate(browser, { premium: true });
    const { page, profileId, on } = candidate;
    await addByTheSection(candidate, "Acme Industrie");
    const [added] = await targetCompaniesOf(on, profileId);
    expect(added).toMatchObject({ name: "ACME INDUSTRIE", spontaneous_application_id: null });

    // Already there: no card, the AI Coach told what to propose on it.
    const again = await ask(candidate, "Trouve-moi des contacts chez Acme Industrie.", [["propose_target_company", { profileId, name: "Acme Industrie" }]]);
    expect(again.cards ?? []).toEqual([]);
    expect(again.reply).toContain("est déjà une entreprise cible");
    expect(again.reply).toContain("propose_target_contact_search");
    expect(await targetCompaniesOf(on, profileId)).toHaveLength(1);

    const targetCompanyId = await idOfRead(candidate, "ACME INDUSTRIE");
    expect(targetCompanyId).toBe(added!.id);

    // Its dossier is not built: no search card; the dossier's build is what to propose.
    const notYet = await ask(candidate, "Trouve-moi des contacts chez Acme Industrie.", [["propose_target_contact_search", { profileId, targetCompanyId }]]);
    expect(notYet.cards ?? []).toEqual([]);
    expect(notYet.reply).toContain("n'est pas constitué");
    expect(notYet.reply).toContain("propose_target_company_dossier");

    const build = await ask(candidate, "Trouve-moi des contacts chez Acme Industrie.", [["propose_target_company_dossier", { profileId, targetCompanyId }]]);
    expect(build.cards).toHaveLength(1);
    expect(build.cards![0]).toMatchObject({ status: "pending", change: { what: tr(texts.fields.targetCompanyDossier, { company: "ACME INDUSTRIE" }), target: { kind: "profile", id: profileId } } });
    // Its Spontaneous Application is prepared on the same click, said on the same card; nothing is built before.
    expect(build.cards![0]!.change.also).toHaveLength(1);
    expect((await targetCompaniesOf(on, profileId))[0]!.spontaneous_application_id).toBeNull();

    await page.goto(`/conversations/${build.conversation.id}`);
    const dossierCard = cardOf(page, tr(texts.fields.targetCompanyDossier, { company: "ACME INDUSTRIE" }));
    await expect(dossierCard).toBeVisible({ timeout: 30_000 });
    await expect(dossierCard).toContainText(texts.quota.companyDossier);
    await expect(dossierCard).toContainText(texts.fields.spontaneousApplication);
    // Launched as « Mettre à jour » is, from the card (`runs`): the Spontaneous Application prepared first, then the dossier built.
    await dossierCard.getByRole("button", { name: texts.update, exact: true }).click();
    await expect(dossierCard.getByText(texts.runResult.company_dossier)).toBeVisible({ timeout: 60_000 });

    // Built, in the Target Company's own Spontaneous Application.
    let application = "";
    await expect
      .poll(
        async () => {
          application = (await targetCompaniesOf(on, profileId))[0]!.spontaneous_application_id ?? "";
          if (!application) return "no application";
          const state = await (await page.request.get(`/api/applications/${application}/company-dossier`)).json();
          return state.status;
        },
        { timeout: 60_000, message: "the dossier is built" },
      )
      .toBe("built");

    // Built: the contact search is now proposed, as for any Application's (Premium, a provider, a built dossier).
    const search = await ask(candidate, "Trouve-moi des contacts chez Acme Industrie.", [["propose_target_contact_search", { profileId, targetCompanyId }]]);
    expect(search.cards).toHaveLength(1);
    expect(search.cards![0]).toMatchObject({ status: "pending", change: { what: texts.fields.contactSearch, target: { kind: "application", id: application } } });
    expect(search.cards![0]!.change.quota?.label).toMatch(/contacts? enrichis? (sur 5 )?cette semaine|illimités/);
    await page.goto(`/conversations/${search.conversation.id}`);
    const searchCard = cardOf(page, texts.fields.contactSearch);
    await expect(searchCard).toBeVisible({ timeout: 30_000 });
    await expect(searchCard).toContainText(texts.values.noPeople);
    expect((await (await page.request.get(`/api/applications/${application}/enriched-contacts`)).json()).found).toEqual([]);
    await searchCard.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(searchCard.getByRole("status")).toBeVisible({ timeout: 30_000 });
    const found = (await (await page.request.get(`/api/applications/${application}/enriched-contacts`)).json()) as { found: { name?: string }[]; contacts: unknown[] };
    expect(found.found).toHaveLength(2);
    expect(found.contacts).toEqual([]);
  });

  // -------------------------------------------------------------------------------- Plan or provider (criterion 2)

  test("a Plan without Enriched Contacts: one sentence and a Typed redirect to « Abonnement », never a card, nobody looked up", async ({ browser }) => {
    const candidate = await newCandidate(browser, { premium: false });
    const { profileId, on } = candidate;
    await addByTheSection(candidate, "Acme Industrie");
    const [company] = await targetCompaniesOf(on, profileId);
    const sentence = "L'offre Gratuit n'inclut pas les contacts enrichis : vous pouvez passer à l'offre Premium depuis Abonnement.";

    const asked = await ask(candidate, "Trouve-moi des contacts chez Acme Industrie.", [["propose_target_contact_search", { profileId, targetCompanyId: company!.id }]], sentence);

    expect(asked.cards ?? []).toEqual([]);
    expect(asked.reply).toBe(sentence);
    expect(asked.reply).not.toMatch(/https?:\/\/|\/abonnement/);
    expect(asked.redirect).toMatchObject({ page: fr.coachRedirects.pages.subscription, object: fr.coachRedirects.objects.plan, href: "/abonnement" });
    // The Plan is as it was, and no application was prepared for the search.
    expect((await targetCompaniesOf(on, profileId))[0]!.spontaneous_application_id).toBeNull();
  });

  test("no contact provider on the server: one sentence and a Typed redirect to the company's dossier, never a card, even on Premium", async ({ browser }) => {
    const candidate = await newCandidate(browser, { premium: true, on: withoutProvider });
    const { profileId, on } = candidate;
    await addByTheSection(candidate, "Acme Industrie");
    const [company] = await targetCompaniesOf(on, profileId);
    const sentence = "La recherche de contacts est indisponible en ce moment : son dossier entreprise dit les fonctions à contacter chez Acme Industrie.";

    const asked = await ask(candidate, "Trouve-moi des contacts chez Acme Industrie.", [["propose_target_contact_search", { profileId, targetCompanyId: company!.id }]], sentence);

    expect(asked.cards ?? []).toEqual([]);
    expect(asked.reply).toBe(sentence);
    // No Application yet: the Profile's Entreprises cibles, where its dossier is built.
    expect(asked.redirect).toMatchObject({ section: fr.profilePage.sections["entreprises-cibles"], object: fr.coachRedirects.objects.company_dossier, href: `/profils/${profileId}/entreprises-cibles` });

    // The same without the say: the AI Coach is told, in the tool's result, not to propose it.
    const told = await ask(candidate, "Trouve-moi des contacts chez Acme Industrie.", [["propose_target_contact_search", { profileId, targetCompanyId: company!.id }]]);
    expect(told.cards ?? []).toEqual([]);
    expect(told.reply).toContain("indisponible");
    expect(told.reply).toContain("ne la propose pas");
  });

  // -------------------------------------------------------------------------- a sole trader is no company (criterion 3)

  test("a name the register lists as a sole trader's is refused with its reason (ADR-0007): no card, nothing added, and the Section's own form refuses it too", async ({ browser }) => {
    const candidate = await newCandidate(browser, { premium: true });
    const { page, profileId, on } = candidate;

    const asked = await ask(candidate, "Ajoute Jeanne Dupontcoach à mes entreprises cibles.", [["propose_target_company", { profileId, name: "Jeanne Dupontcoach" }]]);

    expect(asked.cards ?? []).toEqual([]);
    expect(asked.reply).toContain("n'est pas ajoutée aux entreprises cibles");
    expect(asked.reply).toContain("entrepreneur individuel");
    expect(asked.reply).toContain("une personne et non une entreprise");
    expect(await targetCompaniesOf(on, profileId)).toEqual([]);

    // The Section's own route says the same.
    const manual = await page.request.post(`/api/profiles/${profileId}/target-companies`, { data: { name: "Jeanne Dupontcoach" }, headers: { origin: on.origin } });
    expect(manual.status()).toBe(400);
    expect((await manual.json()).errors).toEqual([{ field: "name", code: "not_a_company" }]);
    expect(await targetCompaniesOf(on, profileId)).toEqual([]);
  });

  // ------------------------------------------------------------------------------------------------------- scope

  test("another Candidate's Profile or Target Company is not_found: no card, nothing of it given", async ({ browser }) => {
    const owner = await newCandidate(browser, { premium: true });
    await addByTheSection(owner, "Acme Industrie");
    const [company] = await targetCompaniesOf(owner.on, owner.profileId);
    const other = await newCandidate(browser, { premium: true });
    await addByTheSection(other, "Acme Industrie");

    for (const [tool, args] of [
      ["read_target_companies", { profileId: owner.profileId }],
      ["propose_target_company", { profileId: owner.profileId, name: "Exemple Industrie" }],
      ["propose_target_company_dossier", { profileId: other.profileId, targetCompanyId: company!.id }],
      ["propose_target_contact_search", { profileId: other.profileId, targetCompanyId: company!.id }],
      ["propose_spontaneous_application", { profileId: other.profileId, targetCompanyId: company!.id }],
    ] as [string, object][]) {
      const asked = await ask(other, "Regarde.", [[tool, args]]);
      expect(asked.cards ?? [], tool).toEqual([]);
      expect(asked.reply, tool).toContain("not_found");
    }
    expect(await targetCompaniesOf(owner.on, owner.profileId)).toHaveLength(1);
    expect(await targetCompaniesOf(other.on, other.profileId)).toHaveLength(1);
  });
});
