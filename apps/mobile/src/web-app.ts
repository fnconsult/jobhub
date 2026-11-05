import { API_CLIENT_HEADER, API_VERSION, API_VERSION_HEADER, MOBILE_CLIENT } from "@jobhub/shared";

/**
 * The web app the app calls (ADR-0076): Production, or the Beta for TestFlight and Play internal testing, set at build
 * time by EXPO_PUBLIC_WEB_APP_URL (`http://localhost:3000` against `npm run dev`).
 */
export const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL || "https://jobbbox.ai";

/** The full address of `path` (an `/api/*` route, a page) on the web app. */
export const webAppAddress = (path: string) => new URL(path, WEB_APP_URL).toString();

/**
 * What the app states on every call to the web app: the API Version it speaks and that it is the Jobbbox app, so an
 * outdated one is answered 426 (#684). A call made with the session also sends its cookie (`AppSession.cookie`, #685).
 */
export const webAppHeaders = (): Record<string, string> => ({ [API_VERSION_HEADER]: String(API_VERSION), [API_CLIENT_HEADER]: MOBILE_CLIENT });

/** Whether `url` is on the web app, the one address a WebView opens (ADR-0076); any other opens in the system browser. */
export function isOnWebApp(url: string): boolean {
  try {
    return new URL(url).origin === new URL(WEB_APP_URL).origin;
  } catch {
    return false;
  }
}
