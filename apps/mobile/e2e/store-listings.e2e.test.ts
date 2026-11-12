// The app's store listings and what is prepared for its first submission (#708, ADR-0076): the texts kept in
// apps/mobile/store in French and in English, the screenshots drawn from the Maestro reference captures (#705), and the
// submission's configuration that does not need the publishing entity. Nothing here submits anything.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEVICES } from "../maestro/devices";
import { KEY_SCREENS } from "../maestro/seed";
import { STORE_SCREENS, STORE_SETS } from "../store/screenshot-sets";

const ROOT = join(__dirname, "..", "..", "..");
const APP = join(ROOT, "apps", "mobile");
const read = (...path: string[]) => readFileSync(join(APP, ...path), "utf8");
const json = (...path: string[]) => JSON.parse(read(...path)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What marks a field that waits for the publishing entity's name, in every file of apps/mobile/store. */
const ENTITY_PENDING = "[ENTITÉ À CONFIRMER]";
const LOCALES = [
  { locale: "fr", store: "fr-FR" },
  { locale: "en", store: "en-US" },
] as const;

/** A listing without its leading comment. */
const listing = (locale: string) => read("store", `${locale}.md`).replace(/<!--[\s\S]*?-->/g, "");

/** A listing's fields with a limit: « ## Nom (30 caractères au plus) », then the text, up to a note in italics or the next heading. */
function fields(locale: string) {
  return [...listing(locale).matchAll(/^## ([^\n(]+?) \(([\d\s,]+) (?:caractères|characters)[^\n]*\n\n([\s\S]*?)(?=\n_|\n#|$(?![\s\S]))/gm)].map((match) => ({
    name: match[1]!,
    limit: Number(match[2]!.replace(/[\s,]/g, "")),
    text: match[3]!.trim(),
  }));
}
const field = (locale: string, ...names: string[]) => fields(locale).find(({ name }) => names.includes(name))!.text;

/** Every string in a catalogue. */
const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
const catalogue = (locale: string) => JSON.parse(readFileSync(join(ROOT, "packages", "shared", "src", "i18n", "locales", `${locale}.json`), "utf8")) as unknown;

/** A PNG's size, from its header. */
function pngSize(file: string) {
  const header = readFileSync(file).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

describe("The store listings' texts", () => {
  it.each(LOCALES)("$locale: every field fits its store's limit", ({ locale }) => {
    const all = fields(locale);
    // Both stores' description; the App Store's name, subtitle, promotional text, keywords and what's new; Google
    // Play's title, short description and release notes.
    expect(all.map(({ limit }) => limit)).toEqual([4000, 30, 30, 170, 100, 4000, 30, 80, 500]);
    for (const { name, limit, text } of all) {
      expect({ name, empty: text === "" }).toEqual({ name, empty: false });
      expect({ name, length: text.length, fits: text.length <= limit }).toEqual({ name, length: text.length, fits: true });
    }
  });

  it.each(LOCALES)("$locale: names the app Jobbbox on both stores, and says the coach is an AI", ({ locale }) => {
    expect(field(locale, "Nom", "Name")).toBe("Jobbbox");
    expect(field(locale, "Titre", "Title")).toBe("Jobbbox");
    expect(field(locale, "Sous-titre", "Subtitle")).toMatch(/\b(IA|AI)\b/);
    expect(field(locale, "Description courte", "Short description")).toMatch(/\b(IA|AI)\b/);
    expect(field(locale, "Description")).toMatch(locale === "fr" ? /intelligence artificielle, pas une personne/ : /artificial intelligence, not a person/);
  });

  it.each(LOCALES)("$locale: a store's description names neither the other platform nor a price", ({ locale }) => {
    const description = field(locale, "Description");
    // App Store guideline 2.3.10 (no other platform in the metadata), and no price or purchase beside the Plan (3.1.3(b)).
    expect(description).not.toMatch(/Android|Google|iPhone|iPad|iOS|Apple|Face ID|VoiceOver|TalkBack/);
    expect(description).not.toMatch(/€|\beuros?\b|abonne[rz]|subscribe|Premium|Standard|Gratuit\b|\bFree\b/i);
  });

  it.each(LOCALES)("$locale: points to the Help Centre and the privacy policy of Production", ({ locale }) => {
    const text = listing(locale);
    for (const url of ["https://jobbbox.ai/aide", "https://jobbbox.ai/legal/confidentialite", "https://jobbbox.ai/aide/utiliser/faq-data-export-deletion"]) expect(text).toContain(url);
    expect(text).not.toContain("staging.jobbbox.ai");
    expect(existsSync(join(ROOT, "packages", "help", "articles", locale, "faq-data-export-deletion.md"))).toBe(true);
  });

  it.each(LOCALES)("$locale: quotes the interface's labels word for word", ({ locale }) => {
    const known = new Set(strings(catalogue(locale)));
    const quoted = [...listing(locale).matchAll(/« ([^»]+) »/g)].map((match) => match[1]!);
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.filter((label) => !known.has(label))).toEqual([]);
  });

  it("the notes for App Review fit App Store Connect's 4,000 characters and quote the English interface", () => {
    const notes = /<!-- notes:start -->([\s\S]*?)<!-- notes:end -->/.exec(read("store", "review-notes.md"))![1]!.trim();
    expect(notes.length).toBeLessThanOrEqual(4000);
    const known = new Set([...strings(catalogue("en")), "Continue with Apple"]); // « Continue with {{provider}} »
    expect([...notes.matchAll(/« ([^»]+) »/g)].map((match) => match[1]!).filter((label) => !known.has(label))).toEqual([]);
    for (const rule of ["3.1.3(b)", "3.1.3(d)", "5.1.1(v)"]) expect(notes).toContain(rule);
  });
});

describe("What waits for the publishing entity", () => {
  it("is marked in the listings, the declarations and the review notes", () => {
    for (const file of ["fr.md", "en.md", "declarations.md", "review-notes.md"]) expect({ file, marked: read("store", file).includes(ENTITY_PENDING) }).toEqual({ file, marked: true });
  });

  it("is in nothing a build or EAS reads: no entity name, account or contact is written before it exists", () => {
    for (const file of ["app.json", "eas.json", "store.config.json", "app.config.ts"]) expect({ file, marked: /ENTIT[ÉE]|CONFIRMER|TODO/.test(read(file)) }).toEqual({ file, marked: false });
    const eas = json("eas.json");
    for (const profile of ["staging", "production"]) {
      for (const key of ["companyName", "appleId", "appleTeamId", "ascAppId"]) expect({ profile, key, value: eas.submit[profile].ios[key] }).toEqual({ profile, key, value: undefined });
    }
    const { apple } = json("store.config.json");
    expect(apple.copyright).toBeUndefined();
    // App Review's contact is a person of the entity: entered in App Store Connect, never here.
    expect(apple.review).toBeUndefined();
  });

  it("stops a production build: mobile.yml refuses it while the marker is in apps/mobile/store", () => {
    const workflow = readFileSync(join(ROOT, ".github", "workflows", "mobile.yml"), "utf8");
    expect(workflow).toContain(`grep -rlF '${ENTITY_PENDING}' apps/mobile/store`);
    expect(workflow.indexOf("grep -rlF")).toBeLessThan(workflow.indexOf("eas build --profile"));
  });
});

describe("The App Store's metadata for `eas metadata:push` (store.config.json)", () => {
  const { apple } = json("store.config.json");

  it.each(LOCALES)("$store: carries the listing's texts, field for field", ({ locale, store }) => {
    expect(apple.info[store]).toEqual({
      title: field(locale, "Nom", "Name"),
      subtitle: field(locale, "Sous-titre", "Subtitle"),
      description: field(locale, "Description"),
      keywords: field(locale, "Mots-clés", "Keywords").split(","),
      promoText: field(locale, "Texte promotionnel", "Promotional text"),
      marketingUrl: "https://jobbbox.ai",
      supportUrl: "https://jobbbox.ai/aide",
      privacyPolicyUrl: "https://jobbbox.ai/legal/confidentialite",
    });
  });

  it("is in French and English, in the listing's categories, released by hand", () => {
    expect(Object.keys(apple.info).sort()).toEqual(["en-US", "fr-FR"]);
    expect(apple.categories).toEqual(["BUSINESS", "PRODUCTIVITY"]);
    expect(apple.release.automaticRelease).toBe(false);
  });

  it("answers the age rating as declarations.md does: nothing rated, no web access, no user content, no advertising", () => {
    const { advisory } = apple;
    const rated = Object.entries(advisory as Record<string, unknown>).filter(([, answer]) => typeof answer === "string" && answer !== "NONE");
    expect(rated).toEqual([]);
    for (const key of ["unrestrictedWebAccess", "gambling", "userGeneratedContent", "advertising", "messagingAndChat", "healthOrWellnessTopics", "lootBox"]) {
      expect({ key, answer: advisory[key] }).toEqual({ key, answer: false });
    }
    expect(advisory.kidsAgeBand).toBeNull();
  });

  it("is the file EAS Submit's profiles name, with French as the app's first language", () => {
    const eas = json("eas.json");
    for (const profile of ["staging", "production"]) expect(eas.submit[profile].ios).toEqual({ language: "fr-FR", appName: "Jobbbox", sku: "ai.jobbbox.app", metadataPath: "store.config.json" });
  });
});

describe("The app's metadata the stores read (app.json)", () => {
  const { expo } = json("app.json");

  it("has its provisional icon: 1024 px for iOS, an adaptive one on the accent for Android", () => {
    expect(pngSize(join(APP, expo.icon))).toEqual({ width: 1024, height: 1024 });
    expect(pngSize(join(APP, expo.android.adaptiveIcon.foregroundImage))).toEqual({ width: 1024, height: 1024 });
    expect(expo.android.adaptiveIcon.backgroundColor).toBe("#4f5fe0");
    // The App Store refuses an icon with an alpha channel: colour type 2 (RGB) in the PNG's header.
    expect(readFileSync(join(APP, expo.icon))[25]).toBe(2);
  });

  it("answers the export compliance question once: only the system's encryption (declarations.md)", () => {
    expect(expo.ios.config.usesNonExemptEncryption).toBe(false);
    expect(read("store", "declarations.md")).toContain("usesNonExemptEncryption: false");
  });

  it("declares no tracking in its privacy manifest, and why it reads the APIs Apple asks a reason for", () => {
    const manifest = expo.ios.privacyManifests;
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
    expect(manifest.NSPrivacyAccessedAPITypes.map((type: { NSPrivacyAccessedAPIType: string }) => type.NSPrivacyAccessedAPIType.replace("NSPrivacyAccessedAPICategory", "")).sort()).toEqual([
      "DiskSpace",
      "FileTimestamp",
      "SystemBootTime",
      "UserDefaults",
    ]);
  });
});

describe("The stores' screenshots (store/screenshots, drawn by store/screenshots.ts)", () => {
  const manifest = json("store", "screenshots", "manifest.json") as Record<string, { source: string; sha256: string }>;
  const names = STORE_SETS.flatMap((set) => STORE_SCREENS.map((screen, index) => ({ set, name: `${set.id}/${index + 1}-${screen.id}.png` })));

  it("cover an iPhone, an iPad, an Android phone and an Android tablet, from the devices whose captures stand for a store", () => {
    expect(STORE_SETS.map(({ id }) => id)).toEqual(["app-store-iphone-6.9", "app-store-ipad-13", "google-play-phone", "google-play-tablet"]);
    const storeDevices = DEVICES.filter((device) => device.store).map((device) => device.id);
    for (const set of STORE_SETS) expect(storeDevices).toContain(set.device);
    for (const screen of STORE_SCREENS) expect(KEY_SCREENS).toContain(screen.id);
    // Google Play asks for two at least, and four for a tablet listing to be featured; the App Store for one.
    expect(STORE_SCREENS.length).toBeGreaterThanOrEqual(4);
  });

  it("are each at a size its store accepts", () => {
    for (const { set, name } of names) expect({ name, ...pngSize(join(APP, "store", "screenshots", name)) }).toEqual({ name, ...set.size });
    // App Store Connect: 6.9" portrait and 13" landscape. Google Play: each side from 320 to 3,840 px (1,080 at least on
    // a tablet), the long side at most twice the short one.
    expect(STORE_SETS[0]!.size).toEqual({ width: 1290, height: 2796 });
    expect(STORE_SETS[1]!.size).toEqual({ width: 2752, height: 2064 });
    for (const { size } of STORE_SETS.slice(2)) {
      const [short, long] = [Math.min(size.width, size.height), Math.max(size.width, size.height)];
      expect(short).toBeGreaterThanOrEqual(1080);
      expect(long).toBeLessThanOrEqual(3840);
      expect(long / short).toBeLessThanOrEqual(2);
    }
    expect(pngSize(join(APP, "store", "screenshots", "google-play-icon.png"))).toEqual({ width: 512, height: 512 });
    expect(pngSize(join(APP, "store", "screenshots", "google-play-feature-graphic.png"))).toEqual({ width: 1024, height: 500 });
  });

  it("come from the light reference captures as they are today: a capture drawn again means running store/screenshots.ts again", () => {
    expect(Object.keys(manifest).sort()).toEqual(names.map(({ name }) => name).sort());
    for (const [name, { source, sha256 }] of Object.entries(manifest)) {
      expect(source).toMatch(/^maestro\/captures\/[a-z-]+\/light\/[a-z]+\.png$/);
      expect({ name, sha256: createHash("sha256").update(readFileSync(join(APP, source))).digest("hex") }).toEqual({ name, sha256 });
    }
    const drawn = STORE_SETS.flatMap((set) => readdirSync(join(APP, "store", "screenshots", set.id)).map((file) => `${set.id}/${file}`));
    expect(drawn.sort()).toEqual(Object.keys(manifest).sort());
  });

  it("keep out the key screen that is not fit for a store yet, as docs/ops/mobile.md says; « accueil » is back since #979", () => {
    expect(STORE_SCREENS.map(({ id }) => id)).toEqual(["accueil", "candidatures", "fiche", "recherches", "agenda"]);
    const doc = readFileSync(join(ROOT, "docs", "ops", "mobile.md"), "utf8");
    for (const words of ["store/screenshots.ts", "accueil", "conversation", ENTITY_PENDING]) expect(doc).toContain(words);
  });
});
