/**
 * Motion Scripts (ADR-0066, #567): the reviewed text of an Explainer Video, one per language, kept in
 * `packages/help/motions/<locale>/<id>.md` beside the Tutorial that names it in its `motion` field. The one source of
 * the video's narration, of its WebVTT captions and of its descriptive transcript; it also declares the pages it films
 * (`routes:`), so a change to one of them flags the video « Motion à régénérer » (docs/agents/documentation.md).
 * Nothing here reads a file: it runs in the browser as well as on the server (the Help Centre shows the transcript, #568).
 *
 *   ---
 *   title: Retrouver une candidature
 *   routes: [/candidatures, /candidatures/[id]]
 *   ---
 *   ## Vos candidatures
 *   - goto /candidatures
 *   - zoom main
 *
 *   « Mes candidatures » liste vos candidatures, la plus récente en haut.
 *
 * Each `##` heading is a step: its title, then its capture actions (list lines, played by Playwright on the demo data,
 * `packages/motions`), then its narration, which says everything shown on screen (WCAG 1.2.5: no separate audio
 * description). The French text prevails; the English one has the same steps and the same actions, with its own labels.
 */
import type { HelpLocale } from "./types";

/**
 * Who the capture is signed in as: the demo Candidate (the dedicated demo seed), nobody (a Visitor's public pages, who
 * may sign up in the video), or a Guest of the browser extension (nobody signed in, the extension loaded: #570).
 */
export const MOTION_VIEWERS = ["candidate", "visitor", "guest"] as const;
export type MotionViewer = (typeof MOTION_VIEWERS)[number];

/** The ARIA roles a capture action may name an element by (Playwright's `getByRole`). */
export const MOTION_ROLES = [
  "banner",
  "button",
  "cell",
  "checkbox",
  "combobox",
  "complementary",
  "contentinfo",
  "dialog",
  "heading",
  "link",
  "listitem",
  "main",
  "menuitem",
  "navigation",
  "option",
  "radio",
  "region",
  "row",
  "search",
  "searchbox",
  "tab",
  "table",
  "textbox",
] as const;
export type MotionRole = (typeof MOTION_ROLES)[number];

/** Landmarks a page has once: named by their role alone (`zoom main`). */
export const UNNAMED_ROLES: readonly MotionRole[] = ["banner", "complementary", "contentinfo", "dialog", "main", "navigation", "search"];

/** An element on screen: by its role and accessible name, by its label, or by its visible text. */
export type MotionTarget = { by: "role"; role: MotionRole; name: string | null } | { by: "label"; text: string } | { by: "text"; text: string };

/** One named capture action (Playwright), in the order the step plays them. */
export type MotionAction =
  | { action: "goto"; path: string }
  | { action: "goto"; page: MotionExtensionPage }
  | { action: "click"; target: MotionTarget }
  | { action: "hover"; target: MotionTarget }
  | { action: "fill"; target: MotionTarget; text: string }
  | { action: "press"; key: string }
  | { action: "scroll"; target: MotionTarget }
  | { action: "zoom"; target: MotionTarget | null }
  | { action: "select"; target: MotionTarget; option: string }
  | { action: "upload"; target: MotionTarget; file: MotionDemoFile }
  | { action: "open-email"; subject: string }
  | { action: "pay"; target: MotionTarget };

export const MOTION_ACTIONS = ["goto", "click", "hover", "fill", "press", "scroll", "zoom", "select", "upload", "open-email", "pay"] as const;

/**
 * The files a capture may give a file input (`upload label "Glissez votre CV ici" "cv-claire-demo.pdf"`): the demo
 * Candidate's CV, written by `packages/motions` from invented lines, never a real one.
 */
export const MOTION_DEMO_FILES = ["cv-claire-demo.pdf"] as const;
export type MotionDemoFile = (typeof MOTION_DEMO_FILES)[number];

/**
 * The pages a Guest's video films outside the web app (#570): `@offre-de-demo`, an invented job offer on a job board
 * the extension knows, served by the capture itself; `@panneau-extension`, the extension's Side Panel, shown beside
 * that offer as Chrome shows it. Only a `guest` script goes there; they are no routes of the web app.
 */
export const MOTION_EXTENSION_PAGES = ["@offre-de-demo", "@panneau-extension"] as const;
export type MotionExtensionPage = (typeof MOTION_EXTENSION_PAGES)[number];

export interface MotionStep {
  /** Shown as the step's title in the video, and a heading of the transcript. */
  title: string;
  actions: MotionAction[];
  /** What the synthetic voice says while the step plays: plain text, one paragraph or more. */
  narration: string;
}

/** A Motion Script in one language. */
export interface MotionScript {
  /** The same in both languages: the script's file name, and the video's folder in the bucket. */
  id: string;
  locale: HelpLocale;
  title: string;
  viewer: MotionViewer;
  /** The app's route patterns the video films (`/candidatures/[id]`), the same in both languages. */
  routes: string[];
  steps: MotionStep[];
  /** The first 12 hex digits of the file's SHA-256: the published files' folder, `<id>/<locale>/<hash>/`. */
  hash: string;
}

/** Where the videos are served from (a Scaleway bucket in fr-par, ADR-0066). */
export const MOTION_MEDIA_ORIGIN = "https://media.jobbbox.ai";

/** The files the `motions` workflow publishes for one script in one language. */
export const MOTION_FILES = { video: "video.mp4", captions: "captions.vtt", transcript: "transcript.md", poster: "poster.jpg" } as const;
export type MotionFile = keyof typeof MOTION_FILES;

/**
 * `<id>/<locale>/<hash>/<render>/<file>`: the bucket key of one published file. The render (when it was rendered,
 * `20261102T090000Z`) sets apart two renders of the same script: a page it films changed (« Motion à régénérer »), or
 * the voice. A published file never changes, so it is cached for good; `manifest.json` names the current render.
 */
export function motionFileKey(id: string, locale: HelpLocale, hash: string, render: string, file: MotionFile): string {
  return `${id}/${locale}/${hash}/${render}/${MOTION_FILES[file]}`;
}

/** The render id of a render at `date`: `20261102T090000Z`. */
export function motionRenderId(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** What the transcript says first: the voice is synthetic (ADR-0066, AI Act art. 50). */
export const SYNTHETIC_VOICE: Record<HelpLocale, string> = { fr: "Voix de synthèse.", en: "Synthetic voice." };
const TRANSCRIPT: Record<HelpLocale, string> = { fr: "Transcription", en: "Transcript" };

/** The descriptive transcript shown under the video: the title, « Voix de synthèse », then each step's title and narration. */
export function motionTranscript(script: Pick<MotionScript, "title" | "locale" | "steps">): string {
  return [
    `# ${script.title}`,
    "",
    `${TRANSCRIPT[script.locale]}. ${SYNTHETIC_VOICE[script.locale]}`,
    ...script.steps.flatMap((step) => ["", `## ${step.title}`, "", step.narration]),
    "",
  ].join("\n");
}

/** The narration as the voice reads it and the captions show it: no Markdown emphasis, single spaces. */
export function plainNarration(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g, (_, a, b, c) => a ?? b ?? c)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The narration's sentences, each read on its own (one caption or more each). A « … » quote never ends a sentence. */
export function narrationSentences(text: string): string[] {
  const plain = plainNarration(text);
  const sentences: string[] = [];
  let current = "";
  let quoted = 0;
  for (let index = 0; index < plain.length; index++) {
    const char = plain[index]!;
    current += char;
    if (char === "«") quoted++;
    if (char === "»") quoted = Math.max(0, quoted - 1);
    const next = plain[index + 1];
    const abbreviation = char === "." && ABBREVIATION.test(current);
    if (quoted === 0 && !abbreviation && /[.!?…]/.test(char) && (next === undefined || next === " ") && !/[.!?…]/.test(next ?? "")) {
      sentences.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) sentences.push(current.trim());
  return sentences;
}

/** A period that ends no sentence: « M. », « Mme. », « p. ex. », « etc. » inside one, « e.g. », an initial. */
const ABBREVIATION = /(?:^|[\s(«“])(?:M|Mme|Mlle|Dr|p|ex|cf|etc|env|e\.g|i\.e|vs|[A-Z])\.$/;

/** Whether `path` (`/candidatures/abc`, maybe under `/en`) is a page of the route pattern `pattern` (`/candidatures/[id]`). */
export function routeMatches(pattern: string, path: string): boolean {
  const pathname = withoutEnglishPrefix(path.split(/[?#]/)[0]!);
  const want = pattern.split("/").filter(Boolean);
  const have = pathname.split("/").filter(Boolean);
  return want.length === have.length && want.every((segment, index) => /^\[[^\].]+\]$/.test(segment) || segment === have[index]);
}

/** A public page's English address (`/en/aide`) is its French route (`/aide`), #545. */
export function withoutEnglishPrefix(path: string): string {
  return path === "/en" ? "/" : path.startsWith("/en/") ? path.slice(3) : path;
}
