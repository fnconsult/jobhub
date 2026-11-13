/**
 * Reads and checks the Motion Scripts' Markdown files (`motions/<locale>/<id>.md`, see `motion-scripts.ts`) and writes
 * them as the `motions.generated.ts` module the app bundles. Node only (reads files): never imported by `index.ts`.
 *
 *   const scripts = readMotionScripts();                                  // a script without its translation throws
 *   checkMotionLinks(readHelpContent(), scripts, readAppRoutes());        // a Tutorial's `motion` naming no script throws
 *   writeFileSync(motionsModulePath, renderMotionsModule(scripts));
 *
 * `packages/motions` reads the same files (and its own test fixtures) with `readMotionScripts(dir)`.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HelpContentError, parseFrontmatter, type HelpContent } from "./content";
import {
  MOTION_ACTIONS,
  MOTION_DEMO_FILES,
  MOTION_EXTENSION_PAGES,
  MOTION_ROLES,
  MOTION_VIEWERS,
  routeMatches,
  UNNAMED_ROLES,
  withoutEnglishPrefix,
  type MotionAction,
  type MotionDemoFile,
  type MotionExtensionPage,
  type MotionRole,
  type MotionScript,
  type MotionStep,
  type MotionTarget,
  type MotionViewer,
} from "./motion-scripts";
import { HELP_SETTINGS_STATES, servedArticles } from "./requirements";
import { HELP_LOCALES, type HelpArticle, type HelpLocale } from "./types";

export type MotionScripts = Record<HelpLocale, MotionScript[]>;

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** This package's own Motion Scripts directory. */
export const motionScriptsDir = path.join(packageDir, "motions");

/** The web app's pages (`apps/web/src/app`): the routes a Motion Script may film. */
export const webAppDir = path.resolve(packageDir, "../../apps/web/src/app");

/** The module `index.ts` serves the Motion Scripts from, written by `renderMotionsModule`. */
export const motionsModulePath = path.join(packageDir, "src", "motions.generated.ts");

/** The source of `motions.generated.ts`: every Motion Script, by id. */
export function renderMotionsModule(scripts: MotionScripts): string {
  const sorted = Object.fromEntries(HELP_LOCALES.map((locale) => [locale, [...scripts[locale]].sort((a, b) => a.id.localeCompare(b.id))]));
  return [
    "// Written by `npm run build -w @jobhub/help` from motions/<locale>/<id>.md: edit those, never this file.",
    'import type { MotionScript } from "./motion-scripts";',
    'import type { HelpLocale } from "./types";',
    "",
    `export const MOTION_SCRIPTS: Record<HelpLocale, readonly MotionScript[]> = ${JSON.stringify(sorted, null, 2)};`,
    "",
  ].join("\n");
}

/** Reads every Motion Script of `dir` (default: this package's `motions/`). Throws `HelpContentError` listing every problem. */
export function readMotionScripts(dir: string = motionScriptsDir): MotionScripts {
  const problems: string[] = [];
  const files = Object.fromEntries(HELP_LOCALES.map((locale) => [locale, markdownFiles(path.join(dir, locale))])) as Record<HelpLocale, string[]>;

  for (const locale of HELP_LOCALES) {
    for (const other of HELP_LOCALES.filter((candidate) => candidate !== locale)) {
      for (const file of files[locale].filter((name) => !files[other].includes(name)))
        problems.push(`${other}/${file} is missing: every Motion Script is written in French and in English`);
    }
  }

  const scripts = Object.fromEntries(
    HELP_LOCALES.map((locale) => [
      locale,
      files[locale].map((file) => {
        const parsed = parseMotionScript(file.replace(/\.md$/, ""), locale, readFileSync(path.join(dir, locale, file), "utf8"));
        problems.push(...parsed.problems.map((problem) => `${locale}/${file}: ${problem}`));
        return parsed.script;
      }),
    ]),
  ) as MotionScripts;

  for (const english of scripts.en) {
    const french = scripts.fr.find((candidate) => candidate.id === english.id);
    if (french) problems.push(...translationProblems(french, english).map((problem) => `en/${english.id}.md: ${problem}`));
  }

  if (problems.length > 0) throw new HelpContentError(problems.join("\n"));
  return scripts;
}

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

/** The script as its file says, and what is wrong with it on its own. */
export function parseMotionScript(id: string, locale: HelpLocale, markdown: string): { script: MotionScript; problems: string[] } {
  const problems: string[] = [];
  const { frontmatter, body } = parseFrontmatter(markdown);
  const text = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
  const title = text(frontmatter.title);
  const viewer = (text(frontmatter.viewer) || "candidate") as MotionViewer;
  const routes = frontmatter.routes;
  if (!title) problems.push("title is missing");
  if (!(MOTION_VIEWERS as readonly string[]).includes(viewer)) problems.push(`viewer must be ${MOTION_VIEWERS.join(" or ")}`);
  // A Guest's video may film the extension alone (#570): no page of the web app, `routes: []`.
  if (!Array.isArray(routes) || (routes.length === 0 && viewer !== "guest")) problems.push("routes is missing: the app's routes the video films, [/candidatures, /candidatures/[id]]");
  else for (const route of routes) if (!route.startsWith("/") || /[?#]/.test(route)) problems.push(`route ${route} must be a path starting with /, with no query`);

  const steps: MotionStep[] = [];
  const blocks = body.split(/^## +/m);
  if (blocks[0]!.trim()) problems.push("text before the first step: every line belongs to a « ## » step");
  for (const block of blocks.slice(1)) {
    const lines = block.split(/\r?\n/);
    const step: MotionStep = { title: lines[0]!.trim(), actions: [], narration: "" };
    const narration: string[] = [];
    for (const line of lines.slice(1)) {
      const item = /^\s*[-*]\s+(.*)$/.exec(line);
      if (item && narration.length === 0) {
        const parsed = parseAction(item[1]!.trim());
        if (typeof parsed === "string") problems.push(`step « ${step.title} »: ${parsed}`);
        else step.actions.push(parsed);
      } else if (item) problems.push(`step « ${step.title} »: capture actions come before the narration`);
      else if (line.trim() || narration.length > 0) narration.push(line);
    }
    step.narration = narration.join("\n").trim();
    if (!step.title) problems.push("a step has no title");
    if (!step.narration) problems.push(`step « ${step.title} » has no narration: the voice says everything shown on screen`);
    steps.push(step);
  }
  if (steps.length === 0) problems.push("no steps: each « ## » heading is a step");
  else if (steps[0]!.actions[0]?.action !== "goto") problems.push("the first step starts with « - goto <path> »");

  for (const step of steps)
    for (const action of step.actions) {
      if (action.action !== "goto") continue;
      if ("page" in action) {
        if (viewer !== "guest") problems.push(`step « ${step.title} »: goto ${action.page} films the extension, for a « viewer: guest » script only`);
      } else if (Array.isArray(routes) && !routes.some((route) => routeMatches(route, action.path)))
        problems.push(`step « ${step.title} »: goto ${action.path} is in none of the routes it declares`);
    }

  const script: MotionScript = {
    id,
    locale,
    title,
    viewer,
    routes: Array.isArray(routes) ? routes : [],
    steps,
    hash: createHash("sha256").update(markdown).digest("hex").slice(0, 12),
  };
  return { script, problems };
}

/** One capture action line (`click button "Enregistrer"`), or what is wrong with it. */
export function parseAction(line: string): MotionAction | string {
  const [verb, ...restWords] = line.split(/\s+/);
  const rest = restWords.join(" ");
  switch (verb) {
    case "goto":
      if ((MOTION_EXTENSION_PAGES as readonly string[]).includes(rest)) return { action: "goto", page: rest as MotionExtensionPage };
      return /^\/\S*$/.test(rest) ? { action: "goto", path: rest } : `goto takes a path starting with /, or ${MOTION_EXTENSION_PAGES.join(" or ")}: « ${line} »`;
    case "open-email": {
      const quoted = quotedStrings(rest);
      return quoted.length === 1 && quoted[0]!.raw === rest.trim() ? { action: "open-email", subject: quoted[0]!.text } : `open-email takes the email's subject, quoted: « ${line} »`;
    }
    case "press":
      return /^\S+$/.test(rest) ? { action: "press", key: rest } : `press takes one key (Enter, Tab…): « ${line} »`;
    case "zoom":
      if (rest === "off") return { action: "zoom", target: null };
    // falls through: zoom on a target
    case "click":
    case "hover":
    case "pay":
    case "scroll": {
      const target = parseTarget(rest);
      return typeof target === "string" ? `${target}: « ${line} »` : { action: verb, target };
    }
    case "fill":
    case "select": {
      const quoted = quotedStrings(rest);
      const filled = quoted.at(-1);
      const target = filled === undefined ? `${verb} needs the ${verb === "fill" ? "text to type" : "option to choose"}, quoted` : parseTarget(rest.slice(0, rest.lastIndexOf(filled.raw)).trim());
      if (typeof target === "string") return `${target}: « ${line} »`;
      return verb === "fill" ? { action: "fill", target, text: filled!.text } : { action: "select", target, option: filled!.text };
    }
    case "upload": {
      const quoted = quotedStrings(rest);
      const file = quoted.at(-1);
      if (!file || !(MOTION_DEMO_FILES as readonly string[]).includes(file.text)) return `upload gives a demo file, ${MOTION_DEMO_FILES.join(" or ")}: « ${line} »`;
      const target = parseTarget(rest.slice(0, rest.lastIndexOf(file.raw)).trim());
      return typeof target === "string" ? `${target}: « ${line} »` : { action: "upload", target, file: file.text as MotionDemoFile };
    }
    default:
      return `unknown capture action « ${verb} »: one of ${MOTION_ACTIONS.join(", ")}`;
  }
}

/** `button "Enregistrer"`, `main`, `label "Intitulé du poste"`, `text "Aucune candidature"`, quoted "…" or « … ». */
function parseTarget(spec: string): MotionTarget | string {
  const match = /^([a-z]+)\s*(.*)$/.exec(spec);
  if (!match) return "an element: a role and its quoted name, label \"…\" or text \"…\"";
  const [, kind, rest] = match as unknown as [string, string, string];
  const quoted = quotedStrings(rest);
  const name = quoted.length === 1 && quoted[0]!.raw === rest.trim() ? quoted[0]!.text : null;
  if (rest.trim() && name === null) return "the name is one quoted text";
  if (kind === "label" || kind === "text") return name ? { by: kind, text: name } : `${kind} needs its quoted text`;
  if (!(MOTION_ROLES as readonly string[]).includes(kind)) return `unknown role « ${kind} »`;
  if (!name && !UNNAMED_ROLES.includes(kind as MotionRole)) return `a ${kind} is named: ${kind} "its label"`;
  return { by: "role", role: kind as MotionRole, name };
}

function quotedStrings(text: string): { raw: string; text: string }[] {
  return [...text.matchAll(/"([^"]*)"|«\s*([^»]*?)\s*»/g)].map((match) => ({ raw: match[0], text: (match[1] ?? match[2])! }));
}

/** The English script plays the French one's steps: same viewer, routes, steps and actions (its labels its own). */
function translationProblems(french: MotionScript, english: MotionScript): string[] {
  const problems: string[] = [];
  if (english.viewer !== french.viewer) problems.push(`its viewer ${english.viewer} differs from the French one (${french.viewer})`);
  if (english.routes.join(" ") !== french.routes.join(" ")) problems.push(`its routes differ from the French ones (${french.routes.join(", ")})`);
  if (english.steps.length !== french.steps.length) return [...problems, `it has ${english.steps.length} steps, the French one ${french.steps.length}`];
  english.steps.forEach((step, index) => {
    const shape = (s: MotionStep) => s.actions.map(actionShape).join(", ");
    if (shape(step) !== shape(french.steps[index]!))
      problems.push(`step ${index + 1} « ${step.title} » plays ${shape(step) || "nothing"}, the French one ${shape(french.steps[index]!) || "nothing"}`);
  });
  return problems;
}

/** An action without its words: `click button`, `goto /aide` (an English page's `/en` left out). */
function actionShape(action: MotionAction): string {
  if (action.action === "goto") return `goto ${"page" in action ? action.page : withoutEnglishPrefix(action.path)}`;
  if (action.action === "press") return `press ${action.key}`;
  if (action.action === "open-email") return "open-email";
  const target = action.target;
  return `${action.action} ${target === null ? "off" : target.by === "role" ? target.role : target.by}`;
}

/** The web app's route patterns (`/candidatures/[id]`), from its `page.tsx` files; route groups left out, catch-alls too. */
export function readAppRoutes(appDir: string = webAppDir): string[] {
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === "page.tsx") routes.push(`/${segments.join("/")}`);
      if (!entry.isDirectory() || entry.name.startsWith("[...") || entry.name.startsWith("[[...")) continue;
      walk(path.join(dir, entry.name), /^\(.*\)$/.test(entry.name) ? segments : [...segments, entry.name]);
    }
  };
  walk(appDir, []);
  return routes.sort();
}

/**
 * The link between Tutorials and Motion Scripts: a Tutorial's `motion` names a script, each script belongs to one
 * Tutorial, and each declared route is a page of the app. Throws `HelpContentError` listing every problem.
 */
export function checkMotionLinks(content: HelpContent, scripts: MotionScripts, appRoutes: readonly string[]): void {
  const problems = new Set<string>();
  for (const locale of HELP_LOCALES) {
    const ids = new Set(scripts[locale].map((script) => script.id));
    // Checked « Espace coach v2 » off and on (#867): a Tutorial and its `.v2` may name the same script, each in its state.
    for (const settings of HELP_SETTINGS_STATES) {
      const owners = new Map<string, string>();
      const file = (article: HelpArticle) => `${locale}/${article.id}.md${article.requires ? ` (requires ${article.requires})` : ""}`;
      for (const article of servedArticles(content[locale], settings)) {
        if (!article.motion) continue;
        if (!ids.has(article.motion)) problems.add(`${file(article)}: its motion ${article.motion} names no Motion Script (motions/${locale}/${article.motion}.md)`);
        const other = owners.get(article.motion);
        if (other) problems.add(`${file(article)}: the Motion Script ${article.motion} already belongs to ${other}`);
        owners.set(article.motion, article.id);
      }
      for (const script of scripts[locale])
        if (!owners.has(script.id))
          problems.add(`motions/${locale}/${script.id}.md: no Tutorial names it in its motion field${settings.coachSpaceV2 ? " (« Espace coach v2 » on)" : ""}`);
    }
    for (const script of scripts[locale]) {
      for (const route of script.routes)
        if (!appRoutes.includes(withoutEnglishPrefix(route))) problems.add(`motions/${locale}/${script.id}.md: route ${route} is no page of the web app`);
    }
  }
  if (problems.size > 0) throw new HelpContentError([...problems].join("\n"));
}
