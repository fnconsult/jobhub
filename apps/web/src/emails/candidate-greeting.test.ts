import { describe, expect, it } from "vitest";
import { appointmentReminderEmail } from "../appointment-reminders/email";
import { cancellationReceiptEmail } from "../billing/cancellation-email";
import { followUpEmail } from "../follow-ups/email";
import { jobDigestEmail } from "../job-digests/email";
import { legalTextNoticeEmail } from "../legal-text-notices/email";
import { nouveautesEmail } from "../nouveautes-email/email";
import { orderConfirmationEmail } from "../orders/email";
import { quotaReductionEmail } from "../quota-reductions/email";
import { twoStepChangeEmail } from "../two-step-verification/email";
import { withdrawalReceiptEmail } from "../withdrawals/email";
import type { RenderedEmail } from "./index";

const URL = "https://app.jobbbox.fr/x";
const at = new Date("2026-11-09T09:00:00Z");

/** Every email sent to a Candidate, for `preferredName` (#921). */
const candidateEmails = (preferredName: string | null): Record<string, RenderedEmail> => ({
  jobDigest: jobDigestEmail({ profileName: "DAF", count: 0, offers: [], digestUrl: URL, unsubscribeUrl: URL, preferredName }, "fr"),
  followUp: followUpEmail("followUp", { jobTitle: "DAF H/F", applicationUrl: URL, settingsUrl: URL, preferredName }, "fr"),
  abandonedFollowUp: followUpEmail("abandoned", { jobTitle: "DAF H/F", applicationUrl: URL, settingsUrl: URL, preferredName }, "fr"),
  appointmentReminder: appointmentReminderEmail(
    { items: [{ table: "coaching_session", scheduledAt: at, durationMinutes: null, note: null, coach: "Sophie Martin", videoLink: null }], agendaUrl: URL, settingsUrl: URL, preferredName },
    "fr",
  ),
  nouveautes: nouveautesEmail({ note: { version: "1.2.0", title: "Nouveautés", intro: "Du neuf.", changes: [] }, noteUrl: URL, unsubscribeUrl: URL, preferredName }, "fr"),
  quotaReduction: quotaReductionEmail(
    { planName: "Standard", quotas: {}, removedFeatures: [], reason: "Coûts.", effectiveOn: "2026-12-14", resolvableUntil: "2027-01-13", resolveUrl: URL, preferredName },
    "fr",
  ),
  orderConfirmation: orderConfirmationEmail(
    {
      kind: "plan",
      subject: "Standard",
      paidAt: at,
      paid: { amount: 1900, currency: "eur" },
      price: null,
      cgv: null,
      immediateExecutionRequested: true,
      withdrawal: { url: URL, until: at },
      preferredName,
    },
    "fr",
  ),
  legalTextNotice: legalTextNoticeEmail({ version: { text: "cgu", effective: "2026-12-14", summary: "Clarifications." }, versionUrl: URL, historyUrl: URL, preferredName }, "fr"),
  cancellationReceipt: cancellationReceiptEmail({ planName: "Standard", freePlanName: "Gratuit", requestedAt: at, endsAt: at, subscriptionUrl: URL, preferredName }, "fr"),
  withdrawalReceipt: withdrawalReceiptEmail(
    { contract: "plan", subject: "Standard", concludedAt: at, paid: null, withdrawnAt: at, name: "Marie Dupont", refunded: null, preferredName },
    "fr",
  ),
  twoStepChange: twoStepChangeEmail({ change: "enabled", at, securityUrl: URL, preferredName }, "fr"),
});

describe("every email to a Candidate greets them by their Preferred Name, or by no name (#921)", () => {
  it.each(Object.entries(candidateEmails("Mimi")))("%s: « Bonjour Mimi, »", (_name, { text, html }) => {
    expect(text.startsWith("Bonjour Mimi,\n\n")).toBe(true);
    expect(html).toContain(">Bonjour Mimi,</p>");
  });

  it.each(Object.entries(candidateEmails(null)))("%s: « Bonjour, » without one", (_name, { text }) => {
    expect(text.startsWith("Bonjour,\n\n")).toBe(true);
  });
});
