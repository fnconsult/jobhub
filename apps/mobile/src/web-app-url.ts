/**
 * The web app a build talks to (ADR-0076), for everything: its sign-in and session (src/session), its calls to the API
 * (src/api) and the web addresses it shares (src/navigation/links). Production, or the Beta for development builds,
 * TestFlight and Play internal testing: EXPO_PUBLIC_WEB_APP_URL, which EAS bakes into the bundle per profile (eas.json,
 * docs/ops/mobile.md); `http://localhost:3000` against `npm run dev`. The only place the app reads it (#704).
 */
export const WEB_APP_URL = (process.env.EXPO_PUBLIC_WEB_APP_URL || "https://jobbbox.ai").replace(/\/$/, "");
