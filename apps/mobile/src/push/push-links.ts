import { paths } from "../navigation/pages";

/** An object's id, as a Push notification carries it: nothing that could leave its page. */
const ID = "[A-Za-z0-9_-]{1,128}";

/**
 * The web app's pages a Push notification opens (apps/web/src/push-notifications/messages.ts), each with the app's
 * page for it: the object's own where the app has one, else its menu.
 */
const LINKS: readonly { web: RegExp; app: (id: string) => string }[] = [
  { web: new RegExp(`^/candidatures/(${ID})$`), app: (id) => paths.application(id) },
  { web: new RegExp(`^/recherches/(${ID})$`), app: () => paths.jobSearches },
  { web: new RegExp(`^/job-digests/(${ID})$`), app: () => paths.jobDigests },
  { web: /^\/agenda$/, app: () => paths.agenda },
  { web: new RegExp(`^/espace-coach/(${ID})$`), app: (id) => `${paths.coachSpace}/${encodeURIComponent(id)}` },
  { web: /^\/espace-coach$/, app: () => paths.coachSpace },
  { web: /^\/$/, app: () => paths.home },
];

/** The value at `keys` in `value`, when every step is an object. */
function at(value: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((current, key) => (typeof current === "object" && current !== null ? (current as Record<string, unknown>)[key] : undefined), value);
}

/**
 * The app's page a tapped Push notification opens (#699), or null. Its data names the object by its web path and id
 * alone (FCM's data, or what APNs carries under `body`; iOS' whole payload as a fallback); anything but one of the pages
 * above, as the web app writes them, is ignored: the payload is never trusted to send the app elsewhere.
 */
export function pushLinkOf(response: unknown): string | null {
  const request = at(response, "notification", "request");
  const path = at(request, "content", "data", "path") ?? at(request, "trigger", "payload", "path");
  if (typeof path !== "string") return null;
  const [pathname, query] = path.split("?", 2) as [string, string | undefined];
  // The Agenda's list is its only query (`?vue=liste`): the app's Agenda is a list.
  if (query !== undefined && !(pathname === "/agenda" && query === "vue=liste")) return null;
  for (const link of LINKS) {
    const match = link.web.exec(pathname);
    if (match) return link.app(match[1] ?? "");
  }
  return null;
}
