/**
 * Whether a state-changing request comes from Jobbbox itself (the web app, the extension, the native app), not from
 * another site riding on the Candidate's session cookie. A browser always states its page's Origin on such a request;
 * the native app states none, and names its scheme in `expo-origin` instead (@better-auth/expo, ADR-0076), which
 * Better Auth's own endpoints read the same way (its Expo plugin). A browser cannot leave its Origin out, so the
 * header never stands in for one.
 */
export function isTrustedOrigin(headers: Headers, trusted: readonly string[]): boolean {
  const origin = headers.get("origin") ?? headers.get("expo-origin");
  return origin !== null && trusted.includes(origin);
}
