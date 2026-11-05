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

/**
 * Where Stripe Checkout sends back a Candidate who pays a Coaching Session from the app (#694, ADR-0076): a page of the
 * web app that the app claims as it claims APP_SIGN_IN_PATH, so that the return opens the app. It proves nothing: the
 * Coaching Session is recorded by Stripe's signed webhook alone (ADR-0016).
 */
export const APP_COACHING_PAYMENT_PATH = "/coachs/paiement";

/** The query APP_COACHING_PAYMENT_PATH carries (`?annule=1`) when the Candidate left Stripe Checkout without paying. */
export const APP_PAYMENT_CANCELLED = "annule";

/**
 * Where a Sign-in Provider sends the app back (#687), in the app's scheme: the system's authentication browser
 * (ASWebAuthenticationSession, Custom Tabs) closes on it, signed in (the session cookie in its `cookie`) or refused (its
 * `error`). A scheme rather than a universal link: an HTTPS return needs iOS 17.4, the app runs from 16.4 (ADR-0076).
 */
export const APP_PROVIDER_RETURN_PATH = "/connexion/fournisseur";

/** Whether `url` is an address in the app's scheme (a return address the app asked for). */
export function isAppAddress(url: string | null | undefined): boolean {
  return typeof url === "string" && url.toLowerCase().startsWith(`${APP_SCHEME}:`);
}

/**
 * The request header in which the Jobbbox app states its version and its system with a Signalement (#690), as its form
 * says before sending: « 1.4.0 (iOS 18.6) ». A native fetch's user agent names neither, so the web app keeps this instead.
 */
export const APP_DEVICE_HEADER = "Jobbbox-App-Device";

/** The Jobbbox app's version (null when it does not know it) and the system it runs on, iPadOS reading as iOS. */
export type AppDevice = { version: string | null; system: "iOS" | "Android"; systemVersion: string };

/** A version as the app and the systems write it: up to four numbers, never a free text. */
const VERSION = String.raw`\d{1,4}(?:\.\d{1,4}){0,3}`;
const APP_DEVICE = new RegExp(String.raw`^(?:(${VERSION}) )?\((iOS|Android) (${VERSION})\)$`);

/** What the app states in APP_DEVICE_HEADER: « 1.4.0 (iOS 18.6) », « (Android 34) » without its version. */
export function appDeviceHeader({ version, system, systemVersion }: AppDevice): string {
  return `${version ? `${version} ` : ""}(${system} ${systemVersion})`;
}

/** The app's version and system from APP_DEVICE_HEADER; null for anything else, so nothing but them is ever kept. */
export function readAppDevice(header: string | null | undefined): AppDevice | null {
  const read = header ? APP_DEVICE.exec(header.trim()) : null;
  if (!read) return null;
  return { version: read[1] ?? null, system: read[2] as AppDevice["system"], systemVersion: read[3]! };
}

/** The app as a Signalement names where it was sent from, for the team: « App Jobbbox 1.4.0, iOS 18.6 ». */
export function appDeviceName({ version, system, systemVersion }: AppDevice): string {
  return `App Jobbbox${version ? ` ${version}` : ""}, ${system} ${systemVersion}`;
}

/**
 * What the app's WebViews add to their user agent (react-native-webview's `applicationNameForUserAgent`, #689): the web
 * app knows by it a page shown inside the app (Mon compte, the subscription, the Legal Texts, the Coach space) and shows
 * it without its own Sidebar, and with no price and nothing to buy (App Store guideline 3.1.1, ADR-0076).
 */
export const APP_WEBVIEW_USER_AGENT = "JobbboxApp";
