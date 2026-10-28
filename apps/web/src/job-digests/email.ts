import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";
import { DIGEST_TIME_ZONE } from "./schedule";

/** One Job Offer as the Job Digest email shows it: a card linking to its page. */
export interface JobDigestEmailOffer {
  title: string;
  employer?: string | null;
  location?: string | null;
  /** Its Posting date; « date unknown » when null. */
  postedAt?: Date | null;
  score: number;
  /** A partial Match Score says so. */
  partial: boolean;
  url: string;
}

/**
 * The Job Digest email: its Job Offers as cards, best Match Score first; the button to the Job Digest, which holds
 * all `count` of them; the unsubscribe link in the footer (the List-Unsubscribe header is the mailer call's).
 */
export function jobDigestEmail(
  digest: { profileName: string; count: number; offers: JobDigestEmailOffer[]; digestUrl: string; unsubscribeUrl: string },
  language: Locale,
): RenderedEmail {
  const i18n = createI18n(language);
  const { t } = i18n;
  const { profileName: profile, count } = digest;
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeZone: DIGEST_TIME_ZONE });
  return renderEmail({
    language,
    subject: t("jobDigest.email.subject", { count, profile }),
    title: t("jobDigest.email.title", { count, profile }),
    body: [
      t("jobDigest.email.intro", { count, profile }),
      ...digest.offers.map(({ title, employer, location, postedAt, score, partial, url }) => ({
        card: {
          title,
          subtitle: [employer, location].filter(Boolean).join(", ") || undefined,
          details: [
            t(partial ? "jobDigest.email.matchScorePartial" : "jobDigest.email.matchScore", { score }),
            postedAt ? t("jobDigest.email.postedAt", { date: day.format(postedAt) }) : t("jobDigest.email.dateUnknown"),
          ],
          url,
        },
      })),
      { action: { label: t("jobDigest.email.seeDigest", { count }), url: digest.digestUrl } },
    ],
    footer: { reason: t("jobDigest.email.reason", { profile }), link: { label: t("jobDigest.email.unsubscribe"), url: digest.unsubscribeUrl } },
  });
}
