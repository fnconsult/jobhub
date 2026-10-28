import AxeBuilder from "@axe-core/playwright";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Issue #472: the seven emails' HTML, as a mail client shows it. Each is rendered from its sample (the one the
// both-languages unit test renders) with the sender's address a mailer writes in (e2e/support/email-samples.ts),
// then compared with its screenshot baseline in the light theme and in a client that follows
// `prefers-color-scheme: dark`, and checked with axe.
// The page has Inter, the Design System's type (ADR-0053), first in the emails' font stack, as a reader's machine may:
// the screenshots then do not hang on which fallback font a machine has.
// Needs no web app: run it alone with E2E_NO_WEB_SERVER=1 npx playwright test --project=emails.
// After a deliberate change, refresh the baselines with --update-snapshots, on macOS and in Linux (CI's): in
// mcr.microsoft.com/playwright:v1.63.0-noble, with its own `npm ci` (native: Chromium does not run emulated on
// Apple silicon), then copy e2e/email-html.spec.ts-snapshots/*-linux.png back.
const EMAILS = ["signIn", "jobDigest", "followUp", "abandonedFollowUp", "appointmentReminder", "appleFailureAlert", "webSearchSpendAlert"];

function renderedEmails(): Record<string, string> {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/email-samples.ts", "fr"], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout) as Record<string, string>;
}

const emails = renderedEmails();

/** Inter, self-hosted (@fontsource-variable/inter), as if installed: it is the font stack's first family. */
const inter = ["latin", "latin-ext"]
  .map((subset) => {
    const woff2 = readFileSync(`node_modules/@fontsource-variable/inter/files/inter-${subset}-wght-normal.woff2`).toString("base64");
    return `@font-face{font-family:"Inter Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${woff2}) format("woff2")}`;
  })
  .join("\n");

test("the seven emails are rendered", () => {
  expect(Object.keys(emails).sort()).toEqual([...EMAILS].sort());
});

for (const name of EMAILS) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${name}, ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setContent(emails[name]!);
      await page.addStyleTag({ content: inter });
      await page.evaluate(() => document.fonts.ready);

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page).toHaveScreenshot(`${name}-${colorScheme}.png`, { fullPage: true, maxDiffPixelRatio: 0.02 });

      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  }
}
