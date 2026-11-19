/**
 * « Pour bien commencer » (#1069, decided in #1044): in an empty conversation's help, above « Souvent demandé », what
 * Jobbbox does beyond the home page that the Candidate has not used yet, each leading to its Help Article. Found without
 * AI, from what the server read of the account (`GET /api/account/getting-started`) and from the browser; the web's
 * help and the native app's read the same.
 *
 *   gettingStarted(account, { now, installsExtensions }, "fr") // the items, in their order; none after 14 days
 *   installsChromeExtensions(navigator)                          // whether this browser installs the extension
 *   gettingStartedOpen(account.createdAt, now)                   // whether the 14 days are still running
 */
import { article } from "./index";
import type { HelpSettings } from "./requirements";
import type { HelpArticle, HelpLocale } from "./types";

/** How long after the account's creation « Pour bien commencer » is shown, in days. */
export const GETTING_STARTED_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the server read of the Candidate's account for « Pour bien commencer ». */
export interface GettingStartedAccount {
  /** When the account was created: an ISO date-time as the API sends it, or a Date. */
  createdAt: string | Date;
  /** An ATS Score exists for a CV of the account. */
  atsScore: boolean;
  /** The account has a Capture from the extension (an Extension Event « Capture », or an Arrival source « Extension »). */
  extensionCapture: boolean;
  /** The extension is on the Chrome Web Store: Mon compte › Outils offers to install it, not « L'extension arrive bientôt ». */
  extensionPublished: boolean;
}

/** Where the help is read: when, and whether this browser can install the extension (`installsChromeExtensions`; never in the app). */
export interface GettingStartedReader {
  now: Date;
  installsExtensions: boolean;
}

/** One feature « Pour bien commencer » presents: its key (the label's, `coachPanel.help.gettingStarted.<key>`) and its Help Article. */
export interface GettingStartedItem {
  key: GettingStartedKey;
  article: HelpArticle;
}

/** Its features, in the order shown. */
const FEATURES = [
  // « L'ATS Score de mon CV »: until an ATS Score exists.
  { key: "atsScore", article: "glossary-ats-score", unused: (account: GettingStartedAccount) => !account.atsScore },
  // « Garder une offre vue sur un autre site »: published, on a browser that installs it, until a first Capture.
  {
    key: "extension",
    article: "page-install-extension",
    unused: (account: GettingStartedAccount, reader: GettingStartedReader) => account.extensionPublished && reader.installsExtensions && !account.extensionCapture,
  },
] as const;

export type GettingStartedKey = (typeof FEATURES)[number]["key"];

/** Whether the account, created at `createdAt`, is still in its first GETTING_STARTED_DAYS days at `now`. */
export function gettingStartedOpen(createdAt: string | Date, now: Date): boolean {
  const age = now.getTime() - new Date(createdAt).getTime();
  return age < GETTING_STARTED_DAYS * DAY_MS;
}

/**
 * « Pour bien commencer »'s items, in their order: the features `account` has not used yet that `reader` can use. None
 * without an account, once the 14 days are over, or when nothing is left to show (the section is then not shown).
 */
export function gettingStarted(account: GettingStartedAccount | null, reader: GettingStartedReader, locale: HelpLocale, settings: HelpSettings = {}): GettingStartedItem[] {
  if (!account || !gettingStartedOpen(account.createdAt, reader.now)) return [];
  return FEATURES.filter((feature) => feature.unused(account, reader)).flatMap((feature) => {
    const found = article(feature.article, locale, settings);
    return found ? [{ key: feature.key, article: found }] : [];
  });
}

/** What a browser says of itself: `navigator` has these. `userAgentData` is Chromium's only, in a secure context. */
export interface BrowserTraits {
  userAgent: string;
  userAgentData?: { brands: readonly { brand: string }[]; mobile: boolean; platform: string } | undefined;
  maxTouchPoints?: number;
}

/** Chromium browsers that cannot install from the Chrome Web Store as they come: Opera needs an add-on first. */
const WITHOUT_STORE = /\b(OPR|OPT|OPX|Opera|Opera GX)\b/;
const PHONE_OR_TABLET = /Android|iPhone|iPad|iPod|Mobile|CriOS|EdgiOS|EdgA|FxiOS/;

/**
 * Whether this browser installs extensions from the Chrome Web Store, on a computer (#1069): Chrome, Edge, Brave and the
 * other Chromium browsers, read from their brands where given, else from the User-Agent; never Opera (an add-on first),
 * Firefox, Safari, nor a phone or a tablet (an iPad asking for the computer's site has a Mac's User-Agent and a touch screen).
 */
export function installsChromeExtensions({ userAgent, userAgentData, maxTouchPoints = 0 }: BrowserTraits): boolean {
  if (PHONE_OR_TABLET.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return false;
  const brands = userAgentData?.brands.map(({ brand }) => brand) ?? [];
  if (userAgentData && brands.length > 0) {
    if (userAgentData.mobile || userAgentData.platform === "Android") return false;
    return brands.includes("Chromium") && !brands.some((brand) => WITHOUT_STORE.test(brand));
  }
  return /\b(Headless)?Chrome\/\d/.test(userAgent) && !WITHOUT_STORE.test(userAgent);
}
