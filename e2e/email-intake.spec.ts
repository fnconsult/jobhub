import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #441 / ADR-0050, ADR-0051: on Mon compte's « Réception par email », the Candidate switches Email intake on
// (dated), sees and replaces their Forwarding address, switches it off, and lists their own sending addresses.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const FORWARDING_ADDRESS = /^[a-z2-7]{16}@alertes\.jobbbox\.ai$/;

test.describe("Email intake: the Forwarding address", () => {
  test("the Candidate switches Email intake on, sees a dated address, replaces it, then switches it off", async ({ page }) => {
    const email = newAddress("email-intake");
    await signInWithMagicLink(page, email);
    await page.goto("/compte/reception-email");
    const intake = page.getByRole("region", { name: fr.emailIntake.title });
    await expect(intake.getByRole("status")).toHaveText(fr.emailIntake.off);

    await intake.getByRole("button", { name: fr.emailIntake.switchOn }).click();
    await expect(intake.getByRole("status")).toHaveText(/^Réception par email activée le \d{1,2}(er)? \S+ \d{4}\.$/);
    const address = intake.getByLabel(fr.emailIntake.addressLabel);
    await expect(address).toHaveValue(FORWARDING_ADDRESS);
    const first = await address.inputValue();

    await page.reload();
    await expect(address).toHaveValue(first);

    await intake.getByRole("button", { name: fr.emailIntake.replace }).click();
    await intake.getByRole("alertdialog").getByRole("button", { name: fr.emailIntake.replace }).click();
    await expect(address).not.toHaveValue(first);
    await expect(address).toHaveValue(FORWARDING_ADDRESS);

    await intake.getByRole("button", { name: fr.emailIntake.switchOff }).click();
    await intake.getByRole("alertdialog").getByRole("button", { name: fr.emailIntake.switchOff }).click();
    await expect(intake.getByRole("status")).toHaveText(fr.emailIntake.off);
    await page.reload();
    await expect(intake.getByRole("button", { name: fr.emailIntake.switchOn })).toBeVisible();
  });

  test("the Candidate adds and removes their own sending addresses; their account's is always one", async ({ page }) => {
    const email = newAddress("email-intake-senders");
    await signInWithMagicLink(page, email);
    await page.goto("/compte/reception-email");
    const senders = page.getByRole("region", { name: fr.emailIntake.sending.title });
    await expect(senders.getByRole("listitem")).toHaveText([fr.emailIntake.sending.account.replace("{{address}}", email.toLowerCase())]);

    await senders.getByLabel(fr.emailIntake.sending.addLabel).fill("Marie@Orange.fr");
    await senders.getByRole("button", { name: fr.emailIntake.sending.add, exact: true }).click();
    await expect(senders.getByRole("listitem")).toHaveCount(2);
    await expect(senders.getByRole("listitem").nth(1)).toContainText("marie@orange.fr");

    await page.reload();
    await senders.getByRole("button", { name: fr.emailIntake.sending.removeLabel.replace("{{address}}", "marie@orange.fr") }).click();
    await expect(senders.getByRole("listitem")).toHaveCount(1);
  });

  test("only a signed-in Candidate can switch Email intake on, replace it, switch it off or add a sending address", async ({ request }) => {
    expect((await request.put("/api/account/email-intake", { headers: { origin } })).status()).toBe(401);
    expect((await request.delete("/api/account/email-intake", { headers: { origin } })).status()).toBe(401);
    expect((await request.post("/api/account/email-intake/replace", { headers: { origin } })).status()).toBe(401);
    expect((await request.post("/api/account/email-intake/sending-addresses", { headers: { origin }, data: { address: "a@b.fr" } })).status()).toBe(401);
  });
});
