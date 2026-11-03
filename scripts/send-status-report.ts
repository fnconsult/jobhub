// Emails the delivery status report (scripts/status-report.mjs) with the app's own mailer and layout:
// `mailerFromEnv` (Brevo's API with BREVO_API_KEY, else SMTP_URL; sent from MAIL_FROM) and `renderEmail` (ADR-0058).
//
//   npx tsx scripts/send-status-report.ts <report.md> [--to dev@jobbbox.ai,…] [--run-url <url>]
//
// Run daily by .github/workflows/status-report.yml. Always sends for real: a missing key or sender fails,
// it never falls back to the console mailer.
import { readFileSync } from "node:fs";
import { mailerFromEnv } from "@jobhub/web/mailers";
import { renderEmail, type EmailBlock } from "../apps/web/src/emails/index.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
if (!file)
  throw new Error(
    "Usage: send-status-report.ts <report.md> [--to a@b,…] [--run-url <url>]",
  );
const to = (opt("to") ?? "dev@jobbbox.ai")
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean);
const runUrl = opt("run-url");

const report = readFileSync(file, "utf8");
const day = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  dateStyle: "long",
}).format(new Date());
const paragraphs: EmailBlock[] = report
  .split(/\n{2,}/)
  .map((p) => p.trim())
  .filter(Boolean);

const email = renderEmail({
  language: "fr",
  subject: `Rapport de livraison du ${day}`,
  title: `Rapport de livraison du ${day}`,
  body: [
    ...paragraphs,
    ...(runUrl ? [{ action: { label: "Voir l’exécution", url: runUrl } }] : []),
  ],
  footer: {
    reason:
      "Vous recevez cet email car votre adresse est destinataire du rapport de livraison quotidien (workflow status-report).",
  },
});

const mailer = mailerFromEnv({ ...process.env, NODE_ENV: "production" });
for (const address of to) {
  await mailer.send({ to: address, ...email });
  console.log(`Emailed the status report to ${address}`);
}
