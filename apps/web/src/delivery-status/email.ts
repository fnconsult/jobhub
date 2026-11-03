import { createI18n, DEFAULT_LOCALE, type Locale } from "@jobhub/shared/i18n";
import type { ExternalApiLog } from "@jobhub/shared";
import { recordingFetch } from "@jobhub/shared";
import type { Mailer } from "../auth";
import { renderEmail, type Email, type EmailBlock } from "../emails";
import { settingHref } from "../platform-settings/parametres";
import { routes } from "../routes";
import { deliveryStatus, gitHubReader, openPullRequestStage, type DeliveryStatus } from "./index";
import { caveatText, environmentName, headlineText, liveCheckText, shortSha, stageName } from "./texts";

/** The Platform Setting naming who gets the daily delivery status email: comma-separated addresses; empty, nobody. */
export const DELIVERY_STATUS_EMAIL_TO = "DELIVERY_STATUS_EMAIL_TO";

/** The daily email is sent at 18:00, French time. */
export const DELIVERY_STATUS_EMAIL_HOUR = 18;
export const DELIVERY_STATUS_EMAIL_TIME_ZONE = "Europe/Paris";

/** The repository Livraison reads when GITHUB_STATUS_REPOSITORY names none. */
export const DEFAULT_DELIVERY_REPOSITORY = "fnconsult/jobhub";

/** The addresses a DELIVERY_STATUS_EMAIL_TO value names: comma or space separated, each with an @, without repeats. */
export function deliveryStatusRecipients(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(/[\s,;]+/)
        .map((address) => address.trim())
        .filter((address) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)),
    ),
  ];
}

/**
 * The daily delivery status email (Back Office › Livraison, ADR-0058): each environment and its live check, what is in
 * flight, each feature's headline, how many things it cannot vouch for, and a button to the page. In French, the team's
 * language; the footer says why it came and links to the setting that stops it.
 */
export function deliveryStatusEmail(status: DeliveryStatus, baseURL: string, locale: Locale = DEFAULT_LOCALE): Email {
  const { t } = createI18n(locale);
  const base = baseURL.replace(/\/$/, "");
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(status.builtAt));
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

  const environments: EmailBlock[] = status.environments.map((env) => ({
    card: {
      title: environmentName(t, env.name),
      details: env.deployment
        ? [t("admin.deliveryStatus.email.deployed", { commit: shortSha(env.deployment.sha), ref: env.deployment.ref, at: at.format(new Date(env.deployment.at)) }), liveCheckText(t, env).text]
        : [liveCheckText(t, env).text],
    },
  }));
  const ahead = status.mainVersusStaging ? [t("admin.deliveryStatus.environments.mainAhead", { count: status.mainVersusStaging.ahead })] : [];

  const inFlight: EmailBlock[] = [
    ...status.inFlight.tickets.map(({ ticket }) => ({ card: { title: `#${ticket.number} ${ticket.title}`, details: [stageName(t, ticket.stage)], url: ticket.url } })),
    ...status.inFlight.pullRequests.map((pr) => ({ card: { title: `${t("admin.deliveryStatus.pullRequest", { number: pr.number })} ${pr.title}`, details: [stageName(t, openPullRequestStage(pr.draft))], url: pr.url } })),
  ];

  const features = [...status.epics.flatMap((epic) => epic.features.map((feature) => ({ feature, epic: epic.title }))), ...status.orphans.flatMap((o) => o.features.map((feature) => ({ feature, epic: undefined })))];
  const featureCards: EmailBlock[] = features
    .filter(({ feature }) => feature.tickets.length > 0)
    .map(({ feature, epic }) => ({
      card: {
        title: feature.direct ? (epic ?? feature.title) : `#${feature.number} ${feature.title}`,
        details: [headlineText(t, feature.headline), feature.counts.map((c) => t("admin.deliveryStatus.count", { count: c.count, stage: stageName(t, c.stage) })).join(" · ")],
        url: feature.url,
      },
    }));

  // The two matching limits are always true: the email names only what this run could not check.
  const caveats = status.caveats.filter((c) => c.kind !== "subIssuesOnly" && c.kind !== "closesOnly");

  return {
    language: locale,
    subject: t("admin.deliveryStatus.email.subject", { date: day }),
    title: t("admin.deliveryStatus.email.title", { date: day }),
    body: [
      t("admin.deliveryStatus.email.intro", { repository: status.repository }),
      t("admin.deliveryStatus.environments.title"),
      ...environments,
      ...ahead,
      t("admin.deliveryStatus.inFlight.title"),
      ...(inFlight.length ? inFlight : [t("admin.deliveryStatus.inFlight.none")]),
      t("admin.deliveryStatus.epics.title"),
      ...(featureCards.length ? featureCards : [t("admin.deliveryStatus.epics.none")]),
      ...(caveats.length ? [`${t("admin.deliveryStatus.caveats.title")} :\n${caveats.map((c) => `- ${caveatText(t, c)}`).join("\n")}`] : []),
      { action: { label: t("admin.deliveryStatus.email.open"), url: `${base}${routes.adminDeliveryStatus}` } },
    ],
    footer: { reason: t("admin.deliveryStatus.email.reason"), link: { label: t("admin.deliveryStatus.email.settings"), url: `${base}${settingHref(DELIVERY_STATUS_EMAIL_TO)}` } },
  };
}

export interface DeliveryStatusEmailsDeps {
  mailer: Mailer;
  baseURL: string;
  /** The values in use: GITHUB_STATUS_TOKEN (Provider Secrets over env), DELIVERY_STATUS_EMAIL_TO (Platform Settings), GITHUB_STATUS_REPOSITORY. */
  env: () => Record<string, string | undefined>;
  /** Where each call to GitHub is recorded, under the Tool `github`. */
  externalApis?: ExternalApiLog;
  /** Reads the status; GitHub's API by default (tests give their own). */
  read?: (token: string, repository: string) => Promise<DeliveryStatus>;
  now?: () => Date;
}

export type DeliveryStatusEmailOutcome = { sent: number; failed: number } | { skipped: "noRecipients" | "missingToken" };

/** The daily delivery status email: read GitHub once, send one email to each address of DELIVERY_STATUS_EMAIL_TO. */
export function createDeliveryStatusEmails(deps: DeliveryStatusEmailsDeps) {
  const read =
    deps.read ??
    ((token: string, repository: string) => {
      const fetch = deps.externalApis
        ? recordingFetch(globalThis.fetch, deps.externalApis, {
            provider: "github",
            costEur: () => 0,
            operation: (method, url) =>
              `${method} ${url.pathname
                .replace(/\/compare\/.*$/, "/compare")
                .replace(/\/\d+(?=\/|$)/g, "/:id")
                .replace(/^\/repos\/[^/]+\/[^/]+/, "/repos/:repo")}`,
          })
        : globalThis.fetch;
      return deliveryStatus(gitHubReader(token, fetch, deps.env().GITHUB_API_URL || undefined), { repository, now: deps.now?.() });
    });

  return {
    async send(): Promise<DeliveryStatusEmailOutcome> {
      const env = deps.env();
      const recipients = deliveryStatusRecipients(env[DELIVERY_STATUS_EMAIL_TO]);
      if (!recipients.length) return { skipped: "noRecipients" };
      const token = env.GITHUB_STATUS_TOKEN?.trim();
      if (!token) return { skipped: "missingToken" };
      const status = await read(token, env.GITHUB_STATUS_REPOSITORY?.trim() || DEFAULT_DELIVERY_REPOSITORY);
      const email = renderEmail(deliveryStatusEmail(status, deps.baseURL));
      let sent = 0;
      let failed = 0;
      for (const to of recipients) {
        try {
          await deps.mailer.send({ to, ...email });
          sent += 1;
        } catch (error) {
          failed += 1;
          console.error(`[delivery-status] the email to one recipient could not be sent: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { sent, failed };
    },
  };
}

export type DeliveryStatusEmails = ReturnType<typeof createDeliveryStatusEmails>;
