import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { totpAt } from "../../apps/web/src/two-step-verification/totp";

// #665, ADR-0075: Two-step verification is mandatory for Administrators and Human Coaches. A magic link signs such an
// account with no factor yet into the second step's page, to set up an authenticator app before anything else; so
// does their next request for someone given a role, or made a coach, while signed in. The suite signs many of them
// in: these helpers set it up the way a person does, on that page, so a spec about something else goes on where it
// was headed. e2e/mandatory-two-step-verification.spec.ts follows the setup itself.

/** The second step's page, when it asks an account with no factor to set one up (SecondStepPage's `data-two-step-setup`). */
export const twoStepSetup = (page: Page) => page.locator("[data-two-step-setup]");

/**
 * Sets up an authenticator app on the second step's page `page` is on, as an Administrator or a Human Coach with no
 * factor does: the app's first code from the key shown, then « J'ai gardé mes codes » once the 10 backup codes show.
 * The page then goes on where it was headed. Returns the key and the backup codes.
 */
export async function setUpTwoStepVerification(page: Page): Promise<{ secret: string; codes: string[] }> {
  const setup = twoStepSetup(page);
  const secret = (await setup.locator("[data-two-step-key]").innerText()).replace(/\s/g, "");
  await setup.getByLabel(/^(Code affiché par l'application|Code the app shows)$/).fill(totpAt(secret, new Date()));
  await setup.getByRole("button", { name: /^(Confirmer|Confirm)$/ }).click();
  const codes = setup.locator("[data-backup-codes] li");
  // The codes show once the server confirmed the code; allInnerTexts does not wait for them.
  await expect(codes).toHaveCount(10);
  const shown = await codes.allInnerTexts();
  await setup.getByRole("button", { name: /^(J'ai gardé mes codes|I have kept my codes)$/ }).click();
  await expect(setup).toHaveCount(0);
  return { secret, codes: shown };
}

/**
 * From now on, whenever `page` shows the setup (someone given a Back Office Role, or made a Human Coach, while signed
 * in, ADR-0075), sets it up: right after a `page.goto` that leads to it, which then answers with the page asked for
 * (a spec reads its status), and otherwise before Playwright's next action or assertion, which then runs where the
 * page was headed.
 */
export async function setUpTwoStepVerificationWhenAsked(page: Page): Promise<void> {
  const setup = twoStepSetup(page);
  const handle = () => page.addLocatorHandler(setup, async () => void (await setUpTwoStepVerification(page)));
  const goto = page.goto.bind(page);
  page.goto = async (url, options) => {
    const response = await goto(url, options);
    if (!(await setup.count())) return response;
    // Set up here, its own actions not handed back to the handler.
    await page.removeLocatorHandler(setup);
    try {
      await setUpTwoStepVerification(page);
    } finally {
      await handle();
    }
    return goto(url, options);
  };
  await handle();
}

/**
 * Forgets the Two-step verification of the account with `email`, if any, in the database at `databaseUrl`: its next
 * magic link then asks an Administrator or a Human Coach to set it up afresh, rather than for a code from an app set
 * up by an earlier test. Nothing without a database (a spec on a server that is not the suite's).
 */
export async function forgetTwoStepVerification(databaseUrl: string | undefined, email: string): Promise<void> {
  if (!databaseUrl) return;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`DELETE FROM two_step_verification WHERE candidate_id IN (SELECT id FROM candidate WHERE lower(email) = lower($1))`, [email]);
  } catch (error) {
    // Before the first migration (a database being created), there is nothing to forget.
    if ((error as { code?: string }).code !== "42P01") throw error;
  } finally {
    await client.end();
  }
}
