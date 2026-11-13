/**
 * The stores' screenshot sets of the Jobbbox app (#708): which reference capture (maestro/captures, #705) fills which
 * slot of App Store Connect and of the Play Console, and at which size. `screenshots.ts` draws them;
 * e2e/store-listings.e2e.test.ts checks what it drew.
 */

/** The Design System's light accent, its soft tint, its line and the text colour (packages/shared/src/design/tokens.ts). */
export const STORE_ICON = { accent: "#4f5fe0", soft: "#eef0fd", line: "#c9cff7", ink: "#1b1b26" } as const;

/**
 * The key screens shown in the stores, in the listing's order, with the French caption of the iPhone set. « accueil »
 * came back with #979, which replaced the provisional home screen. « conversation » is still left out until a seed
 * made for the stores exists (docs/ops/mobile.md): its reply is the test stack's fake provider's.
 */
export const STORE_SCREENS = [
  { id: "accueil", caption: "Votre point du jour, dès l'ouverture" },
  { id: "candidatures", caption: "Vos candidatures et votre coach IA, au même endroit" },
  { id: "fiche", caption: "Chaque candidature a sa fiche : statut, entretiens, documents" },
  { id: "recherches", caption: "Les offres trouvées pour vous, à suivre ou à écarter" },
  { id: "agenda", caption: "Vos entretiens, jour par jour" },
] as const;

export type StoreSet = {
  id: string;
  /** The slot it fills, as the console names it. */
  slot: string;
  /** The device of maestro/devices.ts whose light captures it uses. */
  device: string;
  /** The size of each image, in pixels, one the store accepts for that slot. */
  size: { width: number; height: number };
  /** `copy`: the capture as is; `upright`: drawn again upright (the iPad's landscape capture carries its orientation in EXIF); `frame`: enlarged under a caption. */
  transform: "copy" | "upright" | "frame";
  /** For `frame`: the capture's drawn size and its distance from the foot. */
  frame?: { width: number; height: number; bottom: number };
};

export const STORE_SETS: readonly StoreSet[] = [
  // 750 × 1334 enlarged 1.4 times: soft, and provisional until an iPhone of the 6.9" class joins the Maestro matrix.
  { id: "app-store-iphone-6.9", slot: "App Store, iPhone 6,9 pouces", device: "iphone-se", size: { width: 1290, height: 2796 }, transform: "frame", frame: { width: 1050, height: 1868, bottom: 120 } },
  { id: "app-store-ipad-13", slot: "App Store, iPad 13 pouces", device: "ipad-landscape", size: { width: 2752, height: 2064 }, transform: "upright" },
  { id: "google-play-phone", slot: "Google Play, téléphone", device: "foldable-folded", size: { width: 1080, height: 2092 }, transform: "copy" },
  { id: "google-play-tablet", slot: "Google Play, tablette 7 pouces et 10 pouces", device: "android-tablet", size: { width: 2560, height: 1600 }, transform: "copy" },
];
