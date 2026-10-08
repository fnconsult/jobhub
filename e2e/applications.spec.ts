import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #12: saving a Job Offer creates an Application ("À postuler") on one
// of the Candidate's Profiles, at most one per Job Offer. The Candidate follows
// it in a list or a board, changes its Application Status by hand, records
// dated Interviews while it is at "Entretien", and reads the full Job Offer and
// its Match Score on the Application page.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["Consolidation", "IFRS", "SAP"],
  languages: [],
};

async function createProfile(page: Page, targetRole: string): Promise<string> {
  const saved = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole, location: "Lyon", minSalary: 110_000, contractType: "cdi" } },
    headers: { origin },
  });
  expect(saved.status(), await saved.text()).toBe(201);
  return (await saved.json()).id;
}

async function captureOffer(page: Page, title = "Directeur administratif et financier (H/F)"): Promise<string> {
  const tag = unique();
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: { url: `https://www.apec.fr/offres/daf-${tag}` },
      title,
      content: `Acme Industrie recrute son DAF (réf. ${tag}).\n\nVos missions :\n- Piloter la clôture des comptes\n- Encadrer une équipe de 12 personnes\n\nPROFIL RECHERCHÉ\n\nVous justifiez de 15 ans d'expérience en direction financière.`,
      employer: "Acme Industrie",
      location: "Lyon",
      contractType: "cdi",
      salary: { min: 100_000, max: 120_000 },
      skills: ["IFRS", "Consolidation", "SAP", "Power BI"],
      requiredExperienceYears: 15,
    },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  return (await captured.json()).id;
}

async function saveApplication(page: Page, jobOfferId: string, profileId: string): Promise<string> {
  const saved = await page.request.post("/api/applications", { data: { jobOfferId, profileId }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return (await saved.json()).id;
}

test.describe("Applications", () => {
  test("the Candidate saves a Job Offer with the Profile they pick, and reads it on the Application page", async ({ page }) => {
    // Two Profiles: more than the Free Plan holds.
    const email = newAddress("application-save");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    await createProfile(page, "DAF");
    const consultantId = await createProfile(page, "Consultant transformation");
    const jobOfferId = await captureOffer(page);

    await page.goto(`/offres/${jobOfferId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directeur administratif et financier (H/F)");
    await page.getByLabel(fr.jobOffer.profileLabel).selectOption({ label: "Consultant transformation" });
    await page.getByRole("button", { name: fr.jobOffer.save }).click();

    // The Application page: status, Profile, the full Job Offer laid out, the Match Score with its breakdown.
    await expect(page).toHaveURL(/\/candidatures\/[0-9a-f-]{36}$/);
    await expect(page).toHaveTitle(`Directeur administratif et financier (H/F) · ${fr.app.name}`);
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("to_apply");
    await expect(page.getByLabel(fr.application.profileLabel)).toHaveValue(consultantId);
    const offer = page.getByRole("region", { name: fr.jobOffer.contentTitle });
    await expect(offer.getByRole("heading", { name: "Vos missions :" })).toBeVisible();
    await expect(offer.getByRole("listitem")).toHaveText(["Piloter la clôture des comptes", "Encadrer une équipe de 12 personnes"]);
    await expect(offer.getByRole("heading", { name: "PROFIL RECHERCHÉ" })).toBeVisible();
    await expect(page.getByRole("region", { name: fr.jobOffer.details }).getByText("Acme Industrie", { exact: true })).toBeVisible();
    const score = page.getByRole("region", { name: fr.matchScore.title });
    await expect(score.getByText(/^\d{1,3}\s?\/\s?100$/)).toBeVisible();
    await expect(score.getByText("Power BI")).toBeVisible(); // the missing skill
    await expect(score.getByText(fr.matchScore.criteria.seniority)).toBeVisible();

    // Saving the same Job Offer again leads to the Application the Candidate has: at most one per Job Offer.
    await page.goto(`/offres/${jobOfferId}`);
    await expect(page.getByRole("button", { name: fr.jobOffer.save })).toHaveCount(0);
    await page.getByRole("link", { name: fr.jobOffer.seeApplication }).click();
    await expect(page).toHaveURL(/\/candidatures\/[0-9a-f-]{36}$/);
    const again = await page.request.post("/api/applications", {
      data: { jobOfferId, profileId: consultantId },
      headers: { origin },
    });
    expect(again.status()).toBe(200);
    expect((await again.json()).id).toBe(page.url().split("/").at(-1));
  });

  test("the Candidate follows their Applications in a list and a board, changing the status by hand", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("application-board"));
    const profileId = await createProfile(page, "DAF");
    await saveApplication(page, await captureOffer(page, "Contrôleur de gestion senior"), profileId);
    await saveApplication(page, await captureOffer(page, "DAF groupe industriel"), profileId);

    await page.goto("/compte");
    await page.getByRole("link", { name: fr.nav.applications }).click();
    await expect(page).toHaveURL(`${origin}/candidatures`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.applications.title);

    const row = page.getByRole("row", { name: /DAF groupe industriel/ });
    await row.getByLabel(fr.application.statusLabel).selectOption({ label: fr.applicationStatuses.applied });
    await expect(page.getByRole("status")).toHaveText(fr.application.statusSaved);

    await page.getByRole("link", { name: fr.applications.boardView }).click();
    await expect(page).toHaveURL(`${origin}/candidatures?vue=tableau`);
    const applied = page.getByRole("region", { name: fr.applicationStatuses.applied });
    await expect(applied.getByRole("link", { name: /DAF groupe industriel/ })).toBeVisible();
    const toApply = page.getByRole("region", { name: fr.applicationStatuses.to_apply });
    await expect(toApply.getByRole("link", { name: /Contrôleur de gestion senior/ })).toBeVisible();
    await toApply.getByLabel(fr.application.statusLabel).selectOption({ label: fr.applicationStatuses.abandoned });
    await expect(page.getByRole("region", { name: fr.applicationStatuses.abandoned }).getByRole("link", { name: /Contrôleur/ })).toBeVisible();

    // The board's text meets the accessibility floor (ADR-0009).
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("the list view shows every Application Status in full, at every text size", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInWithMagicLink(page, newAddress("application-list-width"));
    const profileId = await createProfile(page, "DAF");
    await saveApplication(page, await captureOffer(page, "Directeur administratif et financier groupe industriel international (H/F)"), profileId);
    await saveApplication(page, await captureOffer(page, "Contrôleur de gestion senior"), profileId);

    await page.goto("/candidatures");
    const selects = page.locator("tbody").getByLabel(fr.application.statusLabel);
    await expect(selects).toHaveCount(2);

    for (const size of ["standard", "large", "xlarge"]) {
      await page.evaluate((value) => (document.documentElement.dataset.textSize = value), size);
      // Each select is at least as wide as its longest Application Status label, plus its padding and arrow.
      const fits = await selects.evaluateAll((elements) =>
        (elements as HTMLSelectElement[]).map((select) => {
          const style = getComputedStyle(select);
          const probe = document.createElement("span");
          probe.style.font = style.font;
          probe.style.position = "absolute";
          probe.style.whiteSpace = "nowrap";
          document.body.append(probe);
          let widest = 0;
          for (const option of Array.from(select.options)) {
            probe.textContent = option.text;
            widest = Math.max(widest, probe.getBoundingClientRect().width);
          }
          probe.remove();
          const room = select.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20;
          return { room: Math.round(room), widest: Math.round(widest) };
        }),
      );
      for (const { room, widest } of fits) expect(room, `room for the status at text size ${size}`).toBeGreaterThanOrEqual(widest);
    }
  });

  test("an Application at \"Entretien\" holds one or more dated Interviews", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("application-interviews"));
    const applicationId = await saveApplication(page, await captureOffer(page), await createProfile(page, "DAF"));

    await page.goto(`/candidatures/${applicationId}`);
    await expect(page.getByRole("button", { name: fr.application.addInterview })).toHaveCount(0);
    await page.getByLabel(fr.application.statusLabel).selectOption({ label: fr.applicationStatuses.interview });

    const interviews = page.getByRole("region", { name: fr.application.interviewsTitle });
    await interviews.getByLabel(fr.application.interviewDate).fill("2026-11-12T14:30");
    await interviews.getByLabel(fr.application.interviewNote).fill("Avec le PDG");
    await interviews.getByRole("button", { name: fr.application.addInterview }).click();
    await expect(interviews.getByRole("listitem")).toHaveCount(1);
    await interviews.getByLabel(fr.application.interviewDate).fill("2026-11-04T09:00");
    await interviews.getByRole("button", { name: fr.application.addInterview }).click();

    await expect(interviews.getByRole("listitem")).toHaveCount(2);
    await expect(interviews.getByRole("listitem").first()).toContainText("4 novembre 2026");
    await expect(interviews.getByRole("listitem").last()).toContainText("12 novembre 2026");
    await expect(interviews.getByRole("listitem").last()).toContainText("14:30");
    await expect(interviews.getByRole("listitem").last()).toContainText("Avec le PDG");

    await page.reload();
    await expect(page.getByRole("region", { name: fr.application.interviewsTitle }).getByRole("listitem")).toHaveCount(2);
  });

  test("the Candidate switches the Profile an Application uses, and its Match Score follows", async ({ page, browser }) => {
    // Two Profiles: more than the Free Plan holds.
    const email = newAddress("application-profile");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const dafId = await createProfile(page, "DAF");
    const consultantId = await createProfile(page, "Consultant transformation");
    const applicationId = await saveApplication(page, await captureOffer(page), dafId);

    await page.goto(`/candidatures/${applicationId}`);
    const score = page.getByRole("region", { name: fr.matchScore.title });
    await expect(score).toContainText("« DAF »");
    await page.getByLabel(fr.application.profileLabel).selectOption({ label: "Consultant transformation" });
    await expect(page.getByRole("status")).toHaveText(fr.application.profileSaved);
    await expect(score).toContainText("« Consultant transformation »");

    await page.reload();
    await expect(page.getByLabel(fr.application.profileLabel)).toHaveValue(consultantId);

    // A Profile that is not the Candidate's cannot be picked.
    const other = await (await browser.newContext({ baseURL: origin })).newPage();
    await signInWithMagicLink(other, newAddress("application-profile-other"));
    const othersProfile = await createProfile(other, "DAF");
    const refused = await page.request.patch(`/api/applications/${applicationId}`, { data: { profileId: othersProfile }, headers: { origin } });
    expect(refused.status()).toBe(404);
    const savedWithOthers = await page.request.post("/api/applications", {
      data: { jobOfferId: await captureOffer(page), profileId: othersProfile },
      headers: { origin },
    });
    expect(savedWithOthers.status()).toBe(404);
  });

  test("a status changed in the list is kept, and every Application Status can be chosen", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("application-list"));
    const profileId = await createProfile(page, "DAF");
    const applicationId = await saveApplication(page, await captureOffer(page, "Responsable consolidation"), profileId);

    await page.goto("/candidatures");
    const row = page.getByRole("row", { name: /Responsable consolidation/ });
    const status = row.getByLabel(fr.application.statusLabel);
    await expect(status).toHaveValue("to_apply");
    await expect(status.getByRole("option")).toHaveText(["À postuler", "Postulée", "Relancée", "Entretien", "Offre reçue", "Acceptée", "Refusée", "Abandonnée"]);

    await status.selectOption({ label: fr.applicationStatuses.offer_received });
    await expect(page.getByRole("status")).toHaveText(fr.application.statusSaved);
    await page.reload();
    await expect(page.getByRole("row", { name: /Responsable consolidation/ }).getByLabel(fr.application.statusLabel)).toHaveValue("offer_received");
    await page.goto("/candidatures?vue=tableau");
    await expect(page.getByRole("region", { name: fr.applicationStatuses.offer_received }).getByRole("link", { name: /Responsable consolidation/ })).toBeVisible();

    // A status outside the Application Statuses is refused.
    const refused = await page.request.patch(`/api/applications/${applicationId}`, { data: { status: "hired" }, headers: { origin } });
    expect(refused.status()).toBe(400);
  });

  test("Interviews are recorded only at \"Entretien\", can be removed, and are kept when the Application moves on", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("application-interviews-life"));
    const applicationId = await saveApplication(page, await captureOffer(page), await createProfile(page, "DAF"));

    const early = await page.request.post(`/api/applications/${applicationId}/interviews`, { data: { scheduledAt: "2026-11-12T14:30" }, headers: { origin } });
    expect(early.status()).toBe(409);
    expect((await early.json()).error).toBe("not_in_interview");

    await page.goto(`/candidatures/${applicationId}`);
    await expect(page.getByText(fr.application.interviewsHint)).toBeVisible();
    await page.getByLabel(fr.application.statusLabel).selectOption({ label: fr.applicationStatuses.interview });
    const interviews = page.getByRole("region", { name: fr.application.interviewsTitle });

    // A date is required.
    await interviews.getByRole("button", { name: fr.application.addInterview }).click();
    await expect(interviews.getByLabel(fr.application.interviewDate)).toHaveAttribute("aria-invalid", "true");

    for (const when of ["2026-11-04T09:00", "2026-11-12T14:30"]) {
      await interviews.getByLabel(fr.application.interviewDate).fill(when);
      await interviews.getByRole("button", { name: fr.application.addInterview }).click();
      await expect(interviews.getByLabel(fr.application.interviewDate)).toHaveValue("");
    }
    await expect(interviews.getByRole("listitem")).toHaveCount(2);

    await interviews.getByRole("listitem").first().getByRole("button", { name: /4 novembre 2026/ }).click();
    await expect(interviews.getByRole("listitem")).toHaveCount(1);
    await expect(interviews.getByRole("listitem")).toContainText("12 novembre 2026");

    // Moving on to "Offre reçue": the Interview stays, no new one can be added.
    await page.getByLabel(fr.application.statusLabel).selectOption({ label: fr.applicationStatuses.offer_received });
    await expect(interviews.getByRole("button", { name: fr.application.addInterview })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: fr.application.interviewsTitle }).getByRole("listitem")).toHaveCount(1);
  });

  test("an Application is only ever its Candidate's", async ({ page, browser }) => {
    await signInWithMagicLink(page, newAddress("application-owner"));
    const applicationId = await saveApplication(page, await captureOffer(page), await createProfile(page, "DAF"));

    const other = await (await browser.newContext({ baseURL: origin })).newPage();
    await signInWithMagicLink(other, newAddress("application-other"));
    expect((await other.goto(`/candidatures/${applicationId}`))?.status()).toBe(404);
    const patched = await other.request.patch(`/api/applications/${applicationId}`, { data: { status: "applied" }, headers: { origin } });
    expect(patched.status()).toBe(404);

    const anonymous = await (await browser.newContext({ baseURL: origin })).newPage();
    const listed = await anonymous.request.get("/api/applications");
    expect(listed.status()).toBe(401);
  });
});
