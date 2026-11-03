import type { TFunction } from "i18next";
import type { Caveat, EnvironmentStatus, Headline, Stage } from "./index";

/**
 * The delivery status in words, as the Livraison page and its daily email say it: one wording for both.
 */

/** A commit as shown: its first 8 characters. */
export const shortSha = (sha: string) => sha.slice(0, 8);

export const environmentName = (t: TFunction, name: EnvironmentStatus["name"]) => t(`admin.deliveryStatus.environments.names.${name}`);

export const stageName = (t: TFunction, stage: Stage) => t(`admin.deliveryStatus.stages.${stage}`);

export const headlineText = (t: TFunction, h: Headline) =>
  h.kind === "building" ? t("admin.deliveryStatus.headlines.building", { tickets: h.tickets.map((n) => `#${n}`).join(", ") }) : t(`admin.deliveryStatus.headlines.${h.kind}`);

export function caveatText(t: TFunction, c: Caveat): string {
  switch (c.kind) {
    case "branchDeployed":
      return t("admin.deliveryStatus.caveats.branchDeployed", { environment: environmentName(t, c.environment), ref: c.ref });
    case "liveDiffers":
      return t("admin.deliveryStatus.caveats.liveDiffers", { environment: environmentName(t, c.environment), live: shortSha(c.live), deployed: shortSha(c.deployed) });
    case "liveUnverified":
      return t("admin.deliveryStatus.caveats.liveUnverified", { environment: environmentName(t, c.environment) });
    case "openButMerged":
      return t("admin.deliveryStatus.caveats.openButMerged", { issue: `#${c.issue}`, pullRequest: `#${c.pullRequest}` });
    default:
      return t(`admin.deliveryStatus.caveats.${c.kind}`);
  }
}

/** An environment's live check in words: the site serves the deployed commit, another, or why it could not be checked. */
export function liveCheckText(t: TFunction, env: EnvironmentStatus): { text: string; tone: "success" | "danger" | "warn" | "neutral" } {
  if (env.missing) return { text: t("admin.deliveryStatus.environments.missing"), tone: "neutral" };
  if (!env.deployment || !env.live) return { text: t("admin.deliveryStatus.environments.noDeployment"), tone: "neutral" };
  if (env.live.checked)
    return env.live.revision === env.deployment.sha
      ? { text: t("admin.deliveryStatus.environments.liveMatches"), tone: "success" }
      : { text: t("admin.deliveryStatus.environments.liveDiffers", { commit: shortSha(env.live.revision) }), tone: "danger" };
  const reason = env.live.reason;
  return { text: reason.kind === "status" ? t("admin.deliveryStatus.environments.unverified.status", { status: reason.status }) : t(`admin.deliveryStatus.environments.unverified.${reason.kind}`), tone: "warn" };
}
