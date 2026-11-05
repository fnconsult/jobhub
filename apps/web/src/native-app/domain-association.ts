/**
 * The domain association files (#685, ADR-0076): what lets the native app, and it alone, open the web app's links, a
 * universal link on iOS (`apple-app-site-association`) and an App Link on Android (`assetlinks.json`). Each host the
 * web app answers at (`jobbbox.ai`, `staging.jobbbox.ai`) serves them from its own environment; they name the app, its
 * Apple team and its signing certificates, and hold no one's data.
 *
 * iOS opens in the app the magic link's address alone (APP_SIGN_IN_PATH); on Android the app's manifest says which
 * paths it claims (app.json). Until the app's signing is configured (APPLE_TEAM_ID, ANDROID_CERT_SHA256), a file is not
 * served: every link opens the web.
 */
import { APP_IDENTIFIER, APP_SIGN_IN_PATH } from "@jobhub/shared";

type Env = Record<string, string | undefined>;

const APPLE = "/.well-known/apple-app-site-association";
const ANDROID = "/.well-known/assetlinks.json";

/** Where Apple and Android read them, on each host. */
export const DOMAIN_ASSOCIATION_FILES = [APPLE, ANDROID] as const;
export type DomainAssociationFile = (typeof DOMAIN_ASSOCIATION_FILES)[number];

/** The content of `file` for this environment's app, or null when its signing is not configured. */
export function domainAssociation(file: DomainAssociationFile, env: Env): object | null {
  if (file === APPLE) {
    const team = env.APPLE_TEAM_ID?.trim();
    return team ? { applinks: { details: [{ appIDs: [`${team}.${APP_IDENTIFIER}`], components: [{ "/": APP_SIGN_IN_PATH }] }] } } : null;
  }
  const fingerprints = (env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((fingerprint) => fingerprint.trim())
    .filter(Boolean);
  if (fingerprints.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: APP_IDENTIFIER, sha256_cert_fingerprints: fingerprints },
    },
  ];
}

/** The answer at `file`: its JSON (no redirect, as Apple and Android require), or 404 when not configured. */
export function domainAssociationResponse(file: DomainAssociationFile, env: Env): Response {
  const body = domainAssociation(file, env);
  if (!body) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
