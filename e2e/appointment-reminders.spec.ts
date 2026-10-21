import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #253: the Appointment Reminder, emailed the day before each Agenda Item, is on by
// default; the Candidate switches it off (and on again) in Mon compte's Rappels Section.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

test.describe("Appointment Reminders", () => {
  test("the Candidate finds Appointment Reminders on in Mon compte's Rappels Section, and switches them off and on again", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("appointment-reminders"));
    await page.goto("/compte");
    await page.getByRole("link", { name: fr.account.sections.reminders }).click();
    await expect(page).toHaveURL(/\/compte\/rappels$/);

    const reminders = page.getByRole("region", { name: fr.appointmentReminder.settings.title });
    const checkbox = reminders.getByRole("checkbox", { name: fr.appointmentReminder.settings.label });
    await expect(checkbox).toBeChecked();

    await checkbox.uncheck();
    await expect(reminders.getByRole("status")).toHaveText(fr.appointmentReminder.settings.off);
    await page.reload();
    await expect(checkbox).not.toBeChecked();

    await checkbox.check();
    await expect(reminders.getByRole("status")).toHaveText(fr.appointmentReminder.settings.on);
    await page.reload();
    await expect(checkbox).toBeChecked();
  });

  test("only a signed-in Candidate can switch Appointment Reminders, with a yes or no", async ({ request }) => {
    expect((await request.put("/api/account/appointment-reminders", { headers: { origin }, data: { enabled: false } })).status()).toBe(401);
  });
});
