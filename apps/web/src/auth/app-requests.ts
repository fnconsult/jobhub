/**
 * A state-changing request from the native app (ADR-0076): React Native's fetch sends no Origin, and `@better-auth/expo`
 * states the app's in `expo-origin` instead. A browser cannot set that header on a request to another site without CORS,
 * which the web app never allows: so it stands for the Origin, as Better Auth's own endpoints read it (auth/index.ts).
 * A request that has an Origin is a browser's, judged by it alone (isFromTrustedOrigin).
 */
import { APP_ORIGIN } from "@jobhub/shared";

export function isFromTheApp(request: Request): boolean {
  return !request.headers.get("origin") && request.headers.get("expo-origin") === APP_ORIGIN;
}
