/**
 * The native app (ADR-0076) as the web app and the app both name it: its identifier in both stores, its scheme, and
 * the web address a magic link asked from the app opens.
 */

/** The app's bundle identifier (iOS) and package name (Android). */
export const APP_IDENTIFIER = "ai.jobbbox.app";

/** The app's URL scheme (app.json's `expo.scheme`). */
export const APP_SCHEME = "jobbbox";

/**
 * The app's origin, as its requests state it (`expo-origin`, @better-auth/expo) and as the web app trusts it: every
 * address in the app's scheme, its return addresses included (ADR-0011, amended by ADR-0076).
 */
export const APP_ORIGIN = `${APP_SCHEME}://`;

/**
 * Where a magic link asked from the app points (#685): a page of the web app that the app claims by a universal link
 * (iOS) and an App Link (Android), so the link opens the app when it is installed, and signs in on the web otherwise.
 */
export const APP_SIGN_IN_PATH = "/connexion/app";

/** Whether `url` is an address in the app's scheme (a return address the app asked for). */
export function isAppAddress(url: string | null | undefined): boolean {
  return typeof url === "string" && url.toLowerCase().startsWith(`${APP_SCHEME}:`);
}
