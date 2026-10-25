/**
 * What a Signalement keeps of where it was sent from (#283): the page's path, never its query string or `#…`
 * (they can carry a search, an email address, a token), and the browser parsed to name, major version and operating
 * system (« Chrome 141, Mac »), never the raw user agent.
 */

/** Longest path kept: Jobbbox's pages are far shorter. */
const MAX_PATH_LENGTH = 300;

/** The path of a page's address (`/candidatures/…/documents`), without query string or `#…`; null for anything that is not a page. */
export function pagePath(address: unknown): string | null {
  if (typeof address !== "string") return null;
  let path: string;
  if (address.startsWith("/") && !address.startsWith("//")) path = address.split(/[?#]/)[0]!;
  else {
    try {
      const url = new URL(address);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      path = url.pathname;
    } catch {
      return null;
    }
  }
  return path.slice(0, MAX_PATH_LENGTH);
}

/** Browsers, most specific first: Edge, Opera and Samsung Internet also say « Chrome », Chrome also says « Safari ». */
const BROWSERS: [name: string, version: RegExp][] = [
  ["Edge", /\bEdg(?:e|A|iOS)?\/(\d+)/],
  ["Opera", /\b(?:OPR|OPiOS)\/(\d+)/],
  ["Samsung Internet", /\bSamsungBrowser\/(\d+)/],
  ["Firefox", /\b(?:Firefox|FxiOS)\/(\d+)/],
  ["Chrome", /\b(?:Chrome|CriOS)\/(\d+)/],
  ["Safari", /\bVersion\/(\d+)[^]*\bSafari\//],
];

/** Operating systems, most specific first: iOS says « like Mac OS X », Android says « Linux », ChromeOS says « X11 ». */
const SYSTEMS: [name: string, test: RegExp][] = [
  ["iOS", /\b(?:iPhone|iPad|iPod)\b/],
  ["Android", /\bAndroid\b/],
  ["ChromeOS", /\bCrOS\b/],
  ["Windows", /\bWindows\b/],
  ["Mac", /\bMacintosh\b/],
  ["Linux", /\bLinux\b|\bX11\b/],
];

/** The browser of a user agent, as « Chrome 141, Mac »; what cannot be told is named unknown. Null without a user agent. */
export function browserOf(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const browser = BROWSERS.map(([name, version]) => [name, version.exec(userAgent)?.[1]] as const).find(([, major]) => major);
  const system = SYSTEMS.find(([, test]) => test.test(userAgent))?.[0];
  return `${browser ? `${browser[0]} ${browser[1]}` : "Navigateur inconnu"}, ${system ?? "système inconnu"}`;
}
