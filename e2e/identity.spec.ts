import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #918: Mon compte › Identité, first among Mon compte's Sections: the Candidate's Given Name (« Prénom »), Family
// Name (« Nom ») and Preferred Name (« Comment souhaitez-vous que les coachs vous appellent ? »), each optional, saved
// together; the account's name follows « Prénom Nom », and the Data export holds the three.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const identity = fr.account.identity;

const section = (page: Page) => page.getByRole("region", { name: fr.account.sections.identity });
const givenName = (page: Page) => section(page).getByRole("textbox", { name: identity.givenName, exact: true });
const familyName = (page: Page) => section(page).getByRole("textbox", { name: identity.familyName, exact: true });
const preferredName = (page: Page) => section(page).getByRole("textbox", { name: identity.preferredName, exact: true });

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

async function save(page: Page) {
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/account/identity");
  await section(page).getByRole("button", { name: identity.save }).click();
  expect((await saved).ok()).toBe(true);
  await expect(section(page).getByRole("status")).toHaveText(fr.account.saved);
}

for (const width of [1280, 390]) {
  test.describe(`Mon compte › Identité at ${width} px (#918)`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("the Candidate enters, changes and clears their names; axe passes", async ({ page }) => {
      await signInWithMagicLink(page, newAddress(`identite-${width}`));
      // Identité heads the list of Sections; /compte, where a Candidate lands, still shows the Profiles beside it.
      const sections = page.getByRole("navigation", { name: fr.account.sections.sectionsLabel }).first().getByRole("link");
      await expect(sections.first()).toHaveText(fr.account.sections.identity);
      if (width >= 1024) await expect(page.getByText(fr.profiles.none)).toBeVisible();
      await sections.first().click();
      await expect(page).toHaveURL(/\/compte\/identite$/);

      await expect(givenName(page)).toHaveValue("");
      await expect(section(page).getByText(identity.preferredNameHint)).toBeVisible();
      await expectNoAxeViolations(page);

      await givenName(page).fill("  Marie ");
      await familyName(page).fill("Dupont");
      await preferredName(page).fill("Malou");
      await save(page);
      await expect(givenName(page)).toHaveValue("Marie");

      await page.reload();
      await expect(givenName(page)).toHaveValue("Marie");
      await expect(familyName(page)).toHaveValue("Dupont");
      await expect(preferredName(page)).toHaveValue("Malou");
      expect((await (await page.request.get("/api/auth/get-session")).json()).user.name).toBe("Marie Dupont");

      await preferredName(page).fill("");
      await familyName(page).fill("");
      await save(page);
      await expectNoAxeViolations(page);

      const exported = await (await page.request.get("/api/account/export")).json();
      expect(exported.account).toMatchObject({ name: "Marie", givenName: "Marie", familyName: null, preferredName: null });
    });
  });
}
