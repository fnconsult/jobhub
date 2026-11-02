/**
 * The two builds of one Extension Version (#563, ADR-0063), each on its own Chrome Web Store listing: the public one,
 * tied to Production, and the unlisted beta one, tied to the Beta. WXT's build mode picks it (`wxt build` /
 * `wxt zip` for the public one, `--mode beta` for the beta one); the web app it talks to comes from the build, never
 * from a setting the person could change.
 */
export type StoreTarget = "public" | "beta";

export interface BuildTarget {
  /** The store listing this build is for; null for a build that never reaches a store (`wxt dev`, `--mode e2e`). */
  store: StoreTarget | null;
  /** Origin of the Jobbbox web app the extension talks to, and whose session it shares. */
  webOrigin: string;
  /** The manifest's name: a `_locales` message, « Jobbbox (bêta) » for the beta listing. */
  name: string;
  /** Where the toolbar and store icons are, under `public/`. */
  iconDir: string;
}

/** Production and the Beta: the only origins a store build may talk to. */
export const STORE_ORIGINS: Record<StoreTarget, string> = {
  public: "https://jobbbox.ai",
  beta: "https://staging.jobbbox.ai",
};

/** The icon sizes each icon set holds, as `public/<iconDir>/<size>.png`. */
export const ICON_SIZES = [16, 32, 48, 128] as const;

/**
 * The build a WXT mode makes. `production` (WXT's default for `build` and `zip`) and `beta` are store builds, whose
 * origin is fixed so a stray WXT_WEB_ORIGIN cannot point a published extension elsewhere; any other mode
 * (`development`, `e2e`) talks to WXT_WEB_ORIGIN, the local web app by default.
 */
export function buildTarget(mode: string, env: Record<string, string | undefined> = {}): BuildTarget {
  if (mode === "beta") return { store: "beta", webOrigin: STORE_ORIGINS.beta, name: "__MSG_extNameBeta__", iconDir: "icon-beta" };
  const base = { name: "__MSG_extName__", iconDir: "icon" };
  if (mode === "production") return { store: "public", webOrigin: STORE_ORIGINS.public, ...base };
  return { store: null, webOrigin: env.WXT_WEB_ORIGIN || "http://localhost:3000", ...base };
}

/** The manifest's `icons` for a target: `{ "16": "icon/16.png", … }`. */
export function manifestIcons(target: BuildTarget): Record<string, string> {
  return Object.fromEntries(ICON_SIZES.map((size) => [String(size), `${target.iconDir}/${size}.png`]));
}

const EXTENSION_VERSION = /^\d+\.\d+\.\d+$/;

/** Whether a package.json version is an Extension Version: `X.Y.Z`, digits only, as the browser stores require. */
export function isExtensionVersion(version: unknown): version is string {
  return typeof version === "string" && EXTENSION_VERSION.test(version);
}
