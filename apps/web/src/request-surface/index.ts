/**
 * The Surface of a request (#919): where the work it does was asked from, the web app (`web`), the browser extension
 * (`extension`) or the Jobbbox app (`app`), and `worker` for the worker's jobs. AI Usage and the AI Message Log record
 * it with each AI call (« Origine » in the Back Office); nothing else reads it: no request changes with its Surface.
 *
 * It is told from the same headers the origin check reads (isFromTrustedOrigin, api-version's fromExtension and
 * fromJobbboxApp), which a browser cannot forge: an Origin, the native app's `expo-origin` or client name, and on an
 * extension's GET, which carries no Origin, `Sec-Fetch-Site: none` with `Sec-Fetch-Mode: cors`. None of them holds
 * against a client outside a browser: the Surface says where a call came from, it proves nothing.
 *
 * In the web app, `currentRequestSurface()` (./server) reads it from the request being handled.
 */
import { APP_ORIGIN } from "@jobhub/shared";
import { fromExtension, fromJobbboxApp } from "../api-version";

export const SURFACES = ["web", "extension", "app", "worker"] as const;
export type Surface = (typeof SURFACES)[number];

/** The Surface of a request with `headers`, the web app being at `webOrigin`; null when it says none. */
export function requestSurface(headers: Headers, webOrigin: string): Surface | null {
  const origin = headers.get("origin") ?? headers.get("expo-origin");
  if (origin === APP_ORIGIN || (origin === null && fromJobbboxApp(headers))) return "app";
  if (fromExtension(headers)) return "extension";
  return origin === webOrigin ? "web" : null;
}
