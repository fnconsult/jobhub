import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #468: the Design System's File upload, on the CV upload of « Créer un profil ». A CV goes in by the file picker
// or dropped on the drop zone, which lights up while it is dragged over; a file over 10 MB is refused as soon as it is
// chosen, with its error in a Note. The AI provider is faked inside the server (fake-mistral.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const CV = { name: "CV-Marie-Dupont.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(MARIE_DUPONT_CV)) };

const dropZone = (page: Page) => page.locator("[data-drop-zone]");
const fileRow = (page: Page) => page.locator(".ds-upload__file");

test.describe("the File upload on the CV upload (#468)", () => {
  test("a CV chosen with the file picker shows on its row, then is read into the review form", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("upload-picker"));
    await page.goto("/profils/nouveau");
    await expect(dropZone(page)).toContainText(fr.cvUpload.drop);

    const chooser = page.waitForEvent("filechooser");
    await page.locator("[data-drop-zone] label", { hasText: fr.designSystem.upload.choose }).click();
    await (await chooser).setFiles(CV);

    await expect(fileRow(page)).toContainText(CV.name);
    await expect(dropZone(page)).toHaveCount(0);
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();
    await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
  });

  test("a CV dropped on the drop zone lights it up, shows on its row, then is read into the review form", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("upload-drop"));
    await page.goto("/profils/nouveau");
    await page.waitForLoadState("networkidle");

    const dataTransfer = await page.evaluateHandle(
      ({ name, type, bytes }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], name, { type }));
        return transfer;
      },
      { name: CV.name, type: CV.mimeType, bytes: [...CV.buffer] },
    );
    await dropZone(page).dispatchEvent("dragenter", { dataTransfer });
    await expect(dropZone(page)).toHaveAttribute("data-over", "true");
    await dropZone(page).dispatchEvent("drop", { dataTransfer });

    await expect(fileRow(page)).toContainText(CV.name);
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();
    await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
  });

  test("a file over 10 MB shows its error and is not kept", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("upload-too-large"));
    await page.goto("/profils/nouveau");

    const large = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20);
    large.write("%PDF-1.4");
    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles({ name: "CV-lourd.pdf", mimeType: "application/pdf", buffer: large });

    await expect(page.locator(".ds-note[role=alert]")).toHaveText(fr.cvUpload.errors.too_large);
    await expect(fileRow(page)).toHaveCount(0);
    await expect(dropZone(page)).toBeVisible();
    await expect(page.getByRole("button", { name: fr.cvUpload.submit })).toHaveCount(0);
  });

  test("« Partir de zéro » under the drop zone opens the review form left blank", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("upload-scratch"));
    await page.goto("/profils/nouveau");
    await page.getByRole("button", { name: fr.cvUpload.fromScratch }).click();
    await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
  });
});
