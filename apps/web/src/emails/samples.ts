/**
 * The seven emails, each built by its own module from fixed sample data: what the both-languages test
 * (seven-emails.test.ts) and the screenshot baselines (e2e/email-html.spec.ts) render.
 */
import type { Locale } from "@jobhub/shared/i18n";
import { signInEmail } from "../auth/sign-in-email";
import { followUpEmail } from "../follow-ups/email";
import { jobDigestEmail } from "../job-digests/email";
import type { RenderedEmail } from "./index";

export const EMAIL_NAMES = ["signIn", "jobDigest", "followUp", "abandonedFollowUp"] as const;
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
  };
}
