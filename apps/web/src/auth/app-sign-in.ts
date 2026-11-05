/**
 * The magic link asked from the native app (#685, ADR-0076). Better Auth's link verifies the token in whatever opens
 * it, then redirects to its return address: opened in a browser, it would spend the token there. The app's link is
 * instead APP_SIGN_IN_PATH with the token alone, an address of the web app that the app claims by a universal link and
 * an App Link (domain-association.ts): the app opens it and verifies the token itself, keeping the session in the
 * Keychain or Keystore; without the app, the browser opens it and that page signs in on the web.
 */
import { APP_SIGN_IN_PATH, isAppAddress } from "@jobhub/shared";
import { routes } from "../routes";

/** Better Auth's endpoint that verifies a magic link's token. */
const VERIFY_PATH = "/api/auth/magic-link/verify";

/**
 * The link the email carries for Better Auth's magic-link `url`: the app's (APP_SIGN_IN_PATH and the token) when its
 * return address is in the app's scheme, `url` itself otherwise.
 */
export function emailedMagicLink(url: string, baseURL: string): string {
  const link = new URL(url);
  const token = link.searchParams.get("token");
  if (!token || !isAppAddress(link.searchParams.get("callbackURL"))) return url;
  const appLink = new URL(APP_SIGN_IN_PATH, baseURL);
  appLink.searchParams.set("token", token);
  return appLink.toString();
}

/**
 * Where APP_SIGN_IN_PATH sends a browser (the app is not installed, or the link was opened elsewhere): the magic link
 * verified on the web, landing on the home page, or back on the sign-in page with the error when it is no longer valid.
 */
export function webSignInFromAppLink(appLink: URL): URL {
  const token = appLink.searchParams.get("token");
  if (!token) return new URL(routes.signIn, appLink);
  const verify = new URL(VERIFY_PATH, appLink);
  verify.search = new URLSearchParams({ token, callbackURL: routes.home, errorCallbackURL: routes.signIn }).toString();
  return verify;
}
