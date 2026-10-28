/**
 * The seven emails, each built by its own module from fixed sample data: what the both-languages test
 * (seven-emails.test.ts) and the screenshot baselines (e2e/email-html.spec.ts) render.
 */
import type { Locale } from "@jobhub/shared/i18n";
import { appointmentReminderEmail } from "../appointment-reminders/email";
import { signInEmail } from "../auth/sign-in-email";
import { appleFailureEmail } from "../sign-in-providers/alerts";
import { webSearchAlertEmail } from "../web-search-alert";
import { followUpEmail } from "../follow-ups/email";
import { jobDigestEmail } from "../job-digests/email";
import type { RenderedEmail } from "./index";

export const EMAIL_NAMES = ["signIn", "jobDigest", "followUp", "abandonedFollowUp", "appointmentReminder", "appleFailureAlert", "webSearchSpendAlert"] as const;
export type EmailName = (typeof EMAIL_NAMES)[number];

const APP_URL = "https://app.jobbbox.fr";
const application = { jobTitle: "DAF H/F", applicationUrl: `${APP_URL}/candidatures/application-1`, settingsUrl: `${APP_URL}/compte/relances` };

/** Each of the seven emails in `language`, from sample data. */
export function sampleEmails(language: Locale): Record<EmailName, RenderedEmail> {
  return {
    signIn: signInEmail({ url: `${APP_URL}/api/auth/magic-link/verify?token=abc`, minutes: 15 }, language),
    jobDigest: jobDigestEmail(
      {
        profileName: "Directrice administrative et financière",
        count: 12,
        offers: [
          { title: "DAF H/F", employer: "Acme Industrie", location: "Lyon", postedAt: new Date("2026-10-20T08:00:00Z"), score: 92, partial: false, url: `${APP_URL}/offres/offer-1?profil=profile-1` },
          { title: "Responsable financier", employer: "Cabinet Lumière", location: null, postedAt: null, score: 64, partial: true, url: `${APP_URL}/offres/offer-2?profil=profile-1` },
        ],
        digestUrl: `${APP_URL}/job-digests/digest-1`,
        unsubscribeUrl: `${APP_URL}/desabonnement?token=t0k3n&lang=${language}`,
      },
      language,
    ),
    followUp: followUpEmail("followUp", application, language),
    abandonedFollowUp: followUpEmail("abandoned", application, language),
    appointmentReminder: appointmentReminderEmail(
      {
        items: [
          { table: "interview", scheduledAt: new Date("2026-10-21T07:00:00Z"), durationMinutes: 60, note: null, title: "DAF H/F", employer: "Acme Industrie", format: "on_site", place: "12 rue de la République, Lyon" },
          { table: "coaching_session", scheduledAt: new Date("2026-10-21T12:30:00Z"), durationMinutes: 45, note: "Préparer les questions", coach: "Sophie Martin", videoLink: "https://meet.example/abc" },
        ],
        agendaUrl: `${APP_URL}/agenda?vue=liste`,
        settingsUrl: `${APP_URL}/compte/rappels`,
      },
      language,
    ),
    appleFailureAlert: appleFailureEmail([{ id: "apple", reason: "invalid_apple_key" }], APP_URL, language),
    webSearchSpendAlert: webSearchAlertEmail({ month: "2026-10", spendEur: 2.4, thresholdEur: 2 }, APP_URL, language),
  };
}
