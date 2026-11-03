import { recordingFetch } from "@jobhub/shared";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { getSecretResolver } from "@/provider-secrets/server";
import { deliveryStatus, gitHubReader, GitHubApiError, type DeliveryStatus } from "./index";

/** How long a delivery status is shown before GitHub is read again: dozens of calls each time. */
export const DELIVERY_STATUS_TTL_MS = 5 * 60_000;

/** The repository Livraison reads; GITHUB_STATUS_REPOSITORY overrides it. */
const DEFAULT_REPOSITORY = "fnconsult/jobhub";

/** What Livraison shows: the status, or why there is none. */
export type DeliveryStatusRead = { state: "ok"; status: DeliveryStatus } | { state: "missingToken" } | { state: "refused" } | { state: "failed" };

interface Cached {
  /** The token it was read with, so a token replaced in Paramètres reads GitHub again. */
  token: string;
  at: number;
  read: Promise<DeliveryStatusRead>;
}

// On globalThis, not in a module variable: Next.js bundles server code into more than one chunk (see provider-secrets/server.ts).
const holder = globalThis as { __jobhubDeliveryStatus?: Cached };

/** GitHub's API, each call traced under the Tool `github` (Outils), named without its commits or numbers. */
function reader(token: string) {
  const fetch = recordingFetch(globalThis.fetch, getExternalApiLog(), {
    provider: "github",
    costEur: () => 0,
    operation: (method, url) =>
      `${method} ${url.pathname
        .replace(/\/compare\/.*$/, "/compare")
        .replace(/\/\d+(?=\/|$)/g, "/:id")
        .replace(/^\/repos\/[^/]+\/[^/]+/, "/repos/:repo")}`,
  });
  return gitHubReader(token, fetch, process.env.GITHUB_API_URL || undefined);
}

/**
 * The delivery status, read live from GitHub at most every 5 minutes (`refresh` reads it now), shared by every
 * Administrator who opens Livraison. Nothing is stored: a restart reads GitHub again.
 */
export async function deliveryStatusNow(options: { refresh?: boolean } = {}): Promise<DeliveryStatusRead & { readAt: Date }> {
  const token = getSecretResolver().current().env.GITHUB_STATUS_TOKEN?.trim();
  if (!token) return { state: "missingToken", readAt: new Date() };
  const cached = holder.__jobhubDeliveryStatus;
  const fresh = cached && cached.token === token && Date.now() - cached.at < DELIVERY_STATUS_TTL_MS;
  if (!fresh || options.refresh) {
    const read = deliveryStatus(reader(token), { repository: process.env.GITHUB_STATUS_REPOSITORY?.trim() || DEFAULT_REPOSITORY }).then(
      (status): DeliveryStatusRead => ({ state: "ok", status }),
      (error: unknown): DeliveryStatusRead => {
        console.error("Livraison: GitHub could not be read", error instanceof GitHubApiError ? error.message : error);
        return error instanceof GitHubApiError && (error.status === 401 || error.status === 403) ? { state: "refused" } : { state: "failed" };
      },
    );
    holder.__jobhubDeliveryStatus = { token, at: Date.now(), read };
    // A failure is not kept: the next opening tries again.
    void read.then((result) => {
      if (result.state !== "ok" && holder.__jobhubDeliveryStatus?.read === read) holder.__jobhubDeliveryStatus = undefined;
    });
  }
  const current = holder.__jobhubDeliveryStatus!;
  return { ...(await current.read), readAt: new Date(current.at) };
}
