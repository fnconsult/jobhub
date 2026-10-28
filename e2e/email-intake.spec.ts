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

  test("switching on gives an address and records the date; replacing makes the old one unknown, and the export keeps every address with its dates", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("email-intake-export"));
    const headers = { origin };
    expect((await page.request.post("/api/account/email-intake/replace", { headers })).status()).toBe(409);

    const on = await page.request.put("/api/account/email-intake", { headers });
    expect(on.status()).toBe(200);
    const first = await on.json();
    expect(first.address).toMatch(FORWARDING_ADDRESS);
    expect(Date.now() - new Date(first.activatedAt).getTime()).toBeLessThan(5 * 60_000);
    // Switching on again keeps the address and its date.
    expect(await (await page.request.put("/api/account/email-intake", { headers })).json()).toEqual(first);

    const replaced = await (await page.request.post("/api/account/email-intake/replace", { headers })).json();
    expect(replaced.address).toMatch(FORWARDING_ADDRESS);
    expect(replaced.address).not.toBe(first.address);

    await page.request.post("/api/account/email-intake/sending-addresses", { headers, data: { address: "Marie@Orange.fr" } });
    const exported = await (await page.request.get("/api/account/export")).json();
    expect(exported.emailIntake.sendingAddresses).toEqual([{ address: "marie@orange.fr", addedAt: expect.any(String) }]);
    const addresses = exported.emailIntake.forwardingAddresses as { address: string; activatedAt: string }[];
    expect(addresses.map((a) => a.address).sort()).toEqual([first.address, replaced.address].sort());
    expect(addresses.find((a) => a.address === replaced.address)).toMatchObject({ activatedAt: replaced.activatedAt });
    expect(addresses.find((a) => a.address === first.address)).toMatchObject({ activatedAt: first.activatedAt });
    // The page shows only the new address: the old one is no longer in use.
    await page.goto("/compte/reception-email");
    await expect(page.getByLabel(fr.emailIntake.addressLabel)).toHaveValue(replaced.address);
  });

  test("two Candidates never get the same Forwarding address", async ({ page, browser }) => {
    const other = await browser.newPage();
    await signInWithMagicLink(page, newAddress("email-intake-unique-a"));
    await signInWithMagicLink(other, newAddress("email-intake-unique-b"));
    const headers = { origin };
    const given = new Set<string>();
    for (const candidate of [page, other]) {
      given.add((await (await candidate.request.put("/api/account/email-intake", { headers })).json()).address);
      given.add((await (await candidate.request.post("/api/account/email-intake/replace", { headers })).json()).address);
    }
    expect(given.size).toBe(4);
    await other.close();
  });

  test("deleting the account removes the Forwarding and sending addresses: a new account of the same email starts with Email intake off", async ({ page }) => {
    const email = newAddress("email-intake-delete");
    await signInWithMagicLink(page, email);
    const headers = { origin };
    const { address } = await (await page.request.put("/api/account/email-intake", { headers })).json();
    await page.request.post("/api/account/email-intake/sending-addresses", { headers, data: { address: "marie@orange.fr" } });
    expect((await page.request.delete("/api/account", { headers, data: { email } })).status()).toBe(204);

    await signInWithMagicLink(page, email);
    const fresh = await (await page.request.get("/api/account/export")).json();
    expect(fresh.emailIntake).toEqual({ forwardingAddresses: [], sendingAddresses: [], receivedOfferEmails: [], recognisedSenders: [] });
    expect(JSON.stringify(fresh)).not.toContain(address);
    const regained = await (await page.request.put("/api/account/email-intake", { headers })).json();
    expect(regained.address).not.toBe(address);
  });
});
