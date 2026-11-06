/**
 * The domain association files (#685, ADR-0076): what lets the native app, and it alone, open the web app's links, a
 * universal link on iOS (`apple-app-site-association`) and an App Link on Android (`assetlinks.json`). Each host the
 * web app answers at (`jobbbox.ai`, `staging.jobbbox.ai`) serves them from its own environment; they name the app, its
 * Apple team and its signing certificates, and hold no one's data.
 *
 * iOS opens in the app the magic link's address (APP_SIGN_IN_PATH) and Stripe Checkout's return from a Coaching
 * Session paid in the app (APP_COACHING_PAYMENT_PATH, #694), no other; on Android the app's manifest says which paths
 * it claims (app.json). Both files also let the app use the site's passkeys for the second step (#688,
 * `webcredentials` on iOS, `get_login_creds` on Android): a passkey made on jobbbox.ai is offered in the app. Until the app's signing is configured (APPLE_TEAM_ID, ANDROID_CERT_SHA256), a file is not
 * served: every link opens the web.
 */
import { APP_COACHING_PAYMENT_PATH, APP_IDENTIFIER, APP_SIGN_IN_PATH } from "@jobhub/shared";

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
    if (!team) return null;
    const app = `${team}.${APP_IDENTIFIER}`;
    return { applinks: { details: [{ appIDs: [app], components: [{ "/": APP_SIGN_IN_PATH }, { "/": APP_COACHING_PAYMENT_PATH }] }] }, webcredentials: { apps: [app] } };
  }
  const fingerprints = androidCertificates(env);
  if (fingerprints.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: APP_IDENTIFIER, sha256_cert_fingerprints: fingerprints },
    },
  ];
}

/** The SHA-256 fingerprints of the certificates the Android app is signed with (ANDROID_CERT_SHA256, comma-separated). */
function androidCertificates(env: Env): string[] {
  return (env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((fingerprint) => fingerprint.trim())
    .filter(Boolean);
}

/**
 * The origins the Android app's passkey answers carry (#688): `android:apk-key-hash:` and the SHA-256 of the certificate
 * it is signed with, base64url, one per certificate of ANDROID_CERT_SHA256. The iOS app's carry the site's own origin.
 */
export function androidAppOrigins(env: Env): string[] {
  return androidCertificates(env).map((fingerprint) => `android:apk-key-hash:${Buffer.from(fingerprint.replace(/:/g, ""), "hex").toString("base64url")}`);
}

/** The answer at `file`: its JSON (no redirect, as Apple and Android require), or 404 when not configured. */
export function domainAssociationResponse(file: DomainAssociationFile, env: Env): Response {
  const body = domainAssociation(file, env);
  if (!body) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
