"use client";

/*
 * PROTOTYPE — throwaway, do not merge to main (wayfinder map "Sources et modèles IA").
 * Question: what should the bottom bar showing a Candidate page's sources and AI
 * models look like? Three variants, switched with ?variant=A|B|C or ← / →:
 *   A — the request as worded: one fixed line at 9 px, aggregated for the page.
 *   B — readable (ADR-0009): a 14 px collapsed line « Sources et IA » that opens
 *       a table, one row per AI-produced element.
 *   C — per element: 9 px segments, one per element, each opening its detail.
 *   D — like Claude Code's session pane: a top-bar button opens a panel on the
 *       right of the page column listing models, sources and tools, then each
 *       element. &size=9 forces 9 px. Tokens per model and in total.
 *       « ▶ simuler » in the switcher (or &run=1) plays a Job Search: the button
 *       spins (Claude Code's glyph) and the pane fills step by step, live.
 * The data is STUBBED per route: no result table stores its model today
 * (only coach_message does), so nothing real can be shown yet.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Element = { what: string; sources: string[]; model?: string; tools?: string[]; at?: number; tokens?: number; ms?: number };

// « &lendemain=1 » opens the page as if it were the next day, to see dates appear.
let shiftDays = 0;
const now = () => Date.now() + shiftDays * 86_400_000;
// Stubbed production times, minutes before the prototype was loaded.
const loadedAt = Date.now();
const ago = (minutes: number) => loadedAt - minutes * 60_000;

// The time alone when it is today; the date and the time otherwise (the year only if not this one).
function when(at?: number) {
  if (!at) return "";
  const d = new Date(at);
  const today = new Date(now());
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return time;
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  return `${date} à ${time}`;
}

// Durations: « 320 ms », « 4,2 s », « 1 min 05 s ».
function dur(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

// Stubbed time spent per element (its model calls) and per tool, as ai_usage.duration_ms
// and external_api_usage would sum them.
const MS: Record<string, number> = {
  "Offres trouvées": 6400,
  "Variantes de l'intitulé": 820,
  "Résumés des offres": 14300,
  "Coach IA (panneau)": 9100,
  "Résumé de l'offre": 2100,
  "Dossier entreprise": 38500,
  "CV adapté": 27400,
  "Lettre de motivation": 12800,
  Propositions: 5200,
  "Corrections proposées": 6900,
  "CV de référence (lecture du CV importé)": 11600,
};
const TOOL_MS: Record<string, number> = {
  "API France Travail": 1450,
  "API Fantastic.jobs": 2300,
  "Recherche web (Perplexity)": 5800,
  "API Greenhouse / Lever / Ashby": 3100,
  "Lecture de page": 9700,
  "Calcul du Match Score": 180,
  "API Recherche d'entreprises": 640,
  "Actualités (Perplexity)": 4200,
};

// Stubbed token counts per element (input + output), as ai_usage would sum them.
const TOKENS: Record<string, number> = {
  "Offres trouvées": 2140,
  "Variantes de l'intitulé": 312,
  "Résumés des offres": 8420,
  "Coach IA (panneau)": 5630,
  "Résumé de l'offre": 1180,
  "Dossier entreprise": 14250,
  "CV adapté": 9870,
  "Lettre de motivation": 4310,
  Propositions: 2650,
  "Corrections proposées": 3020,
  "CV de référence (lecture du CV importé)": 6740,
};
const withTokens = (elements: Element[]) =>
  elements.map((e) => (e.model && !e.model.startsWith("règles") ? { ...e, tokens: e.tokens ?? TOKENS[e.what] ?? 1500, ms: e.ms ?? MS[e.what] ?? 3000 } : e));
// Tokens, the k stuck to the number from 1 000 on: « 312 », « 2,1k », « 27,4k ».
const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: n < 100_000 ? 1 : 0 })}k`);
// Tokens and time on one line: « 2,1k · 6,4 s ».
const both = (tokens: number, ms: number) => [tokens ? fmt(tokens) : "", ms ? dur(ms) : ""].filter(Boolean).join(" · ");

// A simulated Job Search, as the pane would receive it live (SSE or polling).
type Step = { after: number; text: string; logo: string; model?: string; tool?: string; tokens?: number; ms: number; at?: number; activity: Activity; doing: string };
const RUN: Step[] = [
  // `after` is when the step ends; it runs from the previous step's end. `activity` picks the glyph while it runs.
  { after: 1600, text: "Variantes de l'intitulé", logo: "mistral", model: "mistral-medium", tokens: 312, ms: 790, activity: "think", doing: "Variantes de l'intitulé (mistral-medium)" },
  { after: 3200, text: "API France Travail · 18 offres", logo: "France Travail", tool: "API France Travail", ms: 1320, activity: "search", doing: "Recherche sur France Travail" },
  { after: 4600, text: "API Fantastic.jobs · 10 offres", logo: "Fantastic.jobs", tool: "API Fantastic.jobs", ms: 2050, activity: "search", doing: "Recherche sur Fantastic.jobs" },
  { after: 8600, text: "Recherche web · 3 requêtes", logo: "Perplexity", model: "sonar (Perplexity)", tool: "Recherche web (Perplexity)", tokens: 2140, ms: 5600, activity: "searchRead", doing: "Recherche web (sonar)" },
  { after: 11000, text: "Lecture de page · 12 pages", logo: "Lecture de page", tool: "Lecture de page", ms: 8900, activity: "read", doing: "Lecture des pages d'offres" },
  { after: 14400, text: "Résumés des offres · 12", logo: "claude", model: "claude-haiku-4-5 (Bedrock eu-north-1)", tokens: 8420, ms: 13700, activity: "thinkWrite", doing: "Résumés des offres (claude-haiku-4-5)" },
  { after: 15800, text: "Match Score · 40 offres classées", logo: "règles", tool: "Calcul du Match Score", ms: 160, activity: "compute", doing: "Calcul des Match Scores" },
];
// Tailored Documents being drafted, on the Candidature's Documents section.
const RUN_DOCS: Step[] = [
  { after: 1800, text: "Lecture de l'offre", logo: "Lecture de page", tool: "Lecture de page", ms: 1100, activity: "read", doing: "Lecture de l'offre" },
  { after: 3800, text: "Analyse du CV et de l'offre", logo: "claude", model: "anthropic.claude-opus-5 (Bedrock eu-north-1)", tokens: 3120, ms: 4200, activity: "think", doing: "Analyse du CV et de l'offre (claude-opus-5)" },
  { after: 8000, text: "CV adapté rédigé", logo: "claude", model: "anthropic.claude-opus-5 (Bedrock eu-north-1)", tokens: 9870, ms: 27400, activity: "write", doing: "Rédaction du CV adapté (claude-opus-5)" },
  { after: 11800, text: "Lettre de motivation rédigée", logo: "mistral", model: "mistral-medium (consentement IA UE)", tokens: 4310, ms: 12800, activity: "write", doing: "Rédaction de la lettre (mistral-medium)" },
  { after: 13000, text: "Vérification : aucun fait inventé", logo: "règles", tool: "Garde-fou faits du CV", ms: 240, activity: "compute", doing: "Vérification des faits (ADR-0006)" },
];
const RUNS = {
  search: { steps: RUN, live: "Recherche d'offres en cours", done: "Dernière recherche", stopped: "Recherche arrêtée", failed: "Recherche échouée" },
  docs: { steps: RUN_DOCS, live: "Rédaction des documents en cours", done: "Derniers documents", stopped: "Rédaction arrêtée", failed: "Rédaction échouée" },
};
type RunKind = keyof typeof RUNS;
export type Run = { running: boolean; log: Step[]; kind: RunKind; stoppedAt?: number; failed?: { at: number; step: Step; reason: string } };

function useSimulatedRun(autostart: RunKind | null) {
  const [run, setRun] = useState<Run>({ running: false, log: [], kind: "search" });
  // Each start cancels the previous one's pending steps (Strict Mode runs effects twice).
  const timers = useRef<number[]>([]);
  // `failAt`: the step that fails (« ▶ échec »), ending the run there.
  const start = (kind: RunKind = "search", failAt?: number) => {
    timers.current.forEach((id) => window.clearTimeout(id));
    const steps = RUNS[kind].steps;
    setRun({ running: true, log: [], kind });
    timers.current = steps.map((step, i) =>
      window.setTimeout(() => {
        if (failAt !== undefined && i > failAt) return;
        if (i === failAt) {
          timers.current.forEach((id) => window.clearTimeout(id));
          setRun((r) => ({ ...r, running: false, failed: { at: Date.now(), step, reason: "Perplexity n'a pas répondu (délai dépassé)" } }));
          return;
        }
        setRun((r) => ({ ...r, running: i < steps.length - 1, log: [...r.log, { ...step, at: Date.now() }] }));
      }, step.after),
    );
  };
  // « Arrêter »: the steps not done are dropped; those done stay with their tokens and time (#316).
  const stop = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    setRun((r) => ({ ...r, running: false, stoppedAt: Date.now() }));
  };
  useEffect(() => {
    if (autostart) start(autostart);
    return () => timers.current.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { run, start, stop };
}

// Line icons in the app's style (icons.tsx: 24 grid, stroke 1.5). At rest the
// button shows the tasks icon. During an action it shows what the action is
// doing right now, animated, and morphs into the next activity's icon when the
// step changes. Under prefers-reduced-motion it shows that activity's icon, still.
const TASKS = ["M10 6h10M10 12h10M10 18h10", "M4 6l1.2 1.2L7.5 5", "M4 12l1.2 1.2 2.3-2.2", "M4 18l1.2 1.2 2.3-2.2"];

type Frame = { d: string[]; ms: number; morph?: number };

// Brain, in profile (front to the left): the outline, the cerebellum and the
// brainstem stay; the folds inside shift and sparks flicker at the front, « it thinks ».
const PROFILE = [
  "M6 16.5C3.8 16 2.5 14.2 2.5 12c0-1.2.4-2.3 1.1-3.1C3.7 6.6 5.6 4.8 8 4.5c1-.9 2.4-1.4 3.9-1.2 1.2-.5 2.6-.4 3.7.3 2.3.3 4.2 2 4.8 4.2 1 .7 1.6 1.9 1.6 3.2 0 2.6-2.1 4.7-4.7 4.7H6z",
  "M14.2 16.5c0 1.6 1.3 2.8 2.9 2.8 1.5 0 2.6-1.1 2.6-2.6",
  "M11.2 16.5l-.6 4",
];
// The folds: the lateral fissure, the central sulcus, a frontal and a parietal fold.
const BRAIN: Frame[] = [
  { d: [...PROFILE, "M4 12.6c2.5-.4 5 .2 7.2 1.8", "M12.4 3.6c-.6 2.2.6 3.6-.2 5.8-.5 1.3-.2 2.4.6 3.2", "M6.4 6.6c1.3.6 2 1.8 1.8 3.2", "M16.8 5.6c-.4 1.8.4 3.2 2 3.8"], ms: 160 },
  { d: [...PROFILE, "M4 12.2c2.6-.8 5.2-.2 7.4 1.4", "M12.8 3.6c-.9 2.1.4 3.8-.5 5.8-.4 1.2 0 2.4.9 3.1", "M6 7.2c1.5.3 2.4 1.4 2.4 2.9", "M17.4 5.8c-.7 1.7 0 3.3 1.6 4"], ms: 120 },
  { d: [...PROFILE, "M4 13c2.4 0 4.9.6 7 2.1", "M12 3.6c-.3 2.3.9 3.5.1 5.7-.6 1.4-.4 2.5.4 3.3", "M6.8 6.2c1.1.8 1.7 2 1.4 3.4", "M16.2 5.6c-.2 1.9.7 3.1 2.4 3.6"], ms: 120 },
  { d: [...PROFILE, "M4 12.6c2.5-.4 5 .2 7.2 1.8", "M12.4 3.6c-.6 2.2.6 3.6-.2 5.8-.5 1.3-.2 2.4.6 3.2", "M6.4 6.6c1.3.6 2 1.8 1.8 3.2", "M16.8 5.6c-.4 1.8.4 3.2 2 3.8", "M1.2 8.4L.4 7.8M1 12H0"], ms: 140 },
];

// Magnifier: the lens sweeps over a page, « it searches ».
const lens = (x: number, y: number) => [`M${x} ${y - 6}a6 6 0 1 0 0 12 6 6 0 0 0 0-12z`, `M${x + 4.3} ${y + 4.3}L${x + 8.5} ${y + 8.5}`];
const SEARCH: Frame[] = [
  { d: lens(10, 10), ms: 120 },
  { d: lens(8, 9), ms: 60, morph: 260 },
  { d: lens(11, 8), ms: 60, morph: 260 },
  { d: lens(9, 11), ms: 60, morph: 260 },
];

// Book: it opens and turns its pages, « it reads ».
const BOOK_OPEN = ["M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1z", "M21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z"];
const PAGE_R = "M12 6c2-1.6 4-2.4 6-2.6v14c-2 .2-4 1-6 2.6";
const PAGE_M = "M12 6c.4-1.8.9-3 1.4-4v14c-.5 1-1 2.2-1.4 4";
const PAGE_L = "M12 6c-2-1.6-4-2.4-6-2.6v14c2 .2 4 1 6 2.6";
const READ: Frame[] = [
  { d: BOOK_OPEN, ms: 120, morph: 120 },
  { d: [...BOOK_OPEN, PAGE_R], ms: 30, morph: 170 },
  { d: [...BOOK_OPEN, PAGE_M], ms: 0, morph: 170 },
  { d: [...BOOK_OPEN, PAGE_L], ms: 30, morph: 120 },
];

// Globe: it turns (its meridian narrows and widens), « it goes out on the web ».
const meridian = (w: number) => `M12 3a${w} 9 0 1 0 0 18a${w} 9 0 1 0 0-18z`;
const GLOBE_FRAME = (w: number): Frame => ({ d: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M3 12h18", "M4.5 7.5h15M4.5 16.5h15", meridian(w)], ms: 0, morph: 220 });
const GLOBE: Frame[] = [GLOBE_FRAME(6), GLOBE_FRAME(3.5), GLOBE_FRAME(0.6), GLOBE_FRAME(3.5)];

// Web search: the magnifier sweeps, the globe turns, then the book of results is read.
const SEARCH_READ: Frame[] = [SEARCH[0], SEARCH[1], SEARCH[2], ...GLOBE, ...GLOBE, { d: ["M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z", "M5 18a2 2 0 0 1 2-2h12"], ms: 120 }, ...READ, ...READ];

// Feather: its nib, at (x, y), writes; drawn with relative commands so it moves whole.
const quill = (x: number, y: number, k = 0.72) => {
  const n = (v: number) => +(v * k).toFixed(2);
  return [
    `M${(x + n(16.2)).toFixed(2)} ${(y + n(-14.2)).toFixed(2)}a${n(6)} ${n(6)} 0 0 0 ${n(-8.5)} 0l${n(-5.7)} ${n(5.7)}v${n(6.5)}h${n(6.5)}l${n(5.7)} ${n(-5.7)}a${n(6)} ${n(6)} 0 0 0 0 ${n(-8.5)}z`,
    `M${(x + n(11)).toFixed(2)} ${(y + n(-11)).toFixed(2)}l${n(-11)} ${n(11)}`,
    `M${(x + n(12.5)).toFixed(2)} ${(y + n(-5.5)).toFixed(2)}h${n(-7.5)}`,
  ];
};
const FEATHER = quill(4, 18, 1);
// The nib runs along the line, up and down like handwriting, and the line grows behind it.
const WRITE: Frame[] = [
  // Nearly full size (k 0.92), so the feather reads as one; the nib travels x 2.2 → 5.4 to stay in the 24 grid.
  { d: [...quill(2.2, 20, 0.92), "M1.6 22h.5"], ms: 60, morph: 220 },
  { d: [...quill(3, 19.3, 0.92), "M1.6 22h1.4"], ms: 0, morph: 220 },
  { d: [...quill(3.8, 20.1, 0.92), "M1.6 22h2.2"], ms: 0, morph: 220 },
  { d: [...quill(4.6, 19.3, 0.92), "M1.6 22h3"], ms: 0, morph: 220 },
  { d: [...quill(5.4, 20, 0.92), "M1.6 22h3.8"], ms: 160, morph: 340 },
];

// A model writes its text: the brain thinks, then the feather writes.
const THINK_WRITE: Frame[] = [...BRAIN, ...BRAIN, ...WRITE, ...WRITE];

// Checklist: the ticks appear one by one, « it checks and ranks ».
const COMPUTE: Frame[] = [
  { d: ["M10 6h10M10 12h10M10 18h10"], ms: 120 },
  { d: ["M10 6h10M10 12h10M10 18h10", "M4 6l1.2 1.2L7.5 5"], ms: 120 },
  { d: ["M10 6h10M10 12h10M10 18h10", "M4 6l1.2 1.2L7.5 5", "M4 12l1.2 1.2 2.3-2.2"], ms: 120 },
  { d: TASKS, ms: 260 },
];

export type Activity = "think" | "thinkWrite" | "search" | "searchRead" | "read" | "write" | "compute";
const ACTIVITIES: Record<Activity, { frames: Frame[]; still: string[]; label: string; when: string }> = {
  think: { frames: BRAIN, still: BRAIN[0].d, label: "Réflexion", when: "un modèle raisonne ou classe (variantes de l'intitulé, Match Score par l'IA)" },
  thinkWrite: { frames: THINK_WRITE, still: BRAIN[0].d, label: "Réflexion puis rédaction", when: "un modèle écrit un texte court (résumés des offres, Dossier entreprise)" },
  search: { frames: SEARCH, still: lens(10, 10), label: "Recherche", when: "une API de recherche est appelée (France Travail, Fantastic.jobs, ATS, Recherche d'entreprises)" },
  searchRead: { frames: SEARCH_READ, still: lens(10, 10), label: "Recherche web", when: "loupe, globe, livre : une recherche web part sur le web puis lit les résultats (Perplexity)" },
  read: { frames: READ, still: BOOK_OPEN, label: "Lecture", when: "des pages d'offres ou un CV sont lus" },
  write: { frames: WRITE, still: FEATHER, label: "Rédaction d'un document", when: "un modèle rédige un document : la plume écrit (CV adapté, lettre de motivation)" },
  compute: { frames: COMPUTE, still: TASKS, label: "Calcul", when: "des règles sans IA tournent (Score ATS, Match Score)" },
};

function Glyph({ d, active }: { d: string[]; active?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="1.15em"
      height="1.15em"
      fill="none"
      stroke={active ? "#d97757" : "currentColor"}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none", verticalAlign: "-0.2em" }}
    >
      {d.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

// The glyph morphs: every frame is split into its strokes, each stroke resampled
// into POINTS points (getPointAtLength), and the points interpolated frame by
// frame. Frames with fewer strokes pad with invisible ones, which fade in or out.
// When the activity changes, the glyph morphs from what it shows now into the new
// activity's first frame. No library (see #279's findings).
const POINTS = 40;
const STROKES = 9;
type Pt = [number, number];
type Shape = { pts: Pt[]; on: number }[];
const cache = new Map<string, Shape>();
let probe: SVGPathElement | null = null;

function shapeOf(d: string[]): Shape {
  const key = d.join("|");
  const hit = cache.get(key);
  if (hit) return hit;
  if (!probe) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.style.position = "absolute";
    svg.style.visibility = "hidden";
    svg.appendChild(probe);
    document.body.appendChild(svg);
  }
  const p = probe;
  const strokes = d
    .flatMap((path) => path.split(/(?=M)/).map((x) => x.trim()).filter(Boolean))
    .map((x) => {
      p.setAttribute("d", x);
      const length = p.getTotalLength();
      const pts = Array.from({ length: POINTS }, (_, k) => {
        const point = p.getPointAtLength((length * k) / (POINTS - 1));
        return [point.x, point.y] as Pt;
      });
      return { pts, on: 1 };
    });
  // Padding strokes sit, collapsed, on the centre, so they grow out of it.
  while (strokes.length < STROKES) strokes.push({ pts: Array.from({ length: POINTS }, () => [12, 12] as Pt), on: 0 });
  const shape = strokes.slice(0, STROKES);
  cache.set(key, shape);
  return shape;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const toPath = (pts: Pt[]) => "M" + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L");
const mix = (a: Shape, b: Shape, m: number): Shape =>
  a.map((s, k) => ({ pts: s.pts.map(([x, y], j) => [x + (b[k].pts[j][0] - x) * m, y + (b[k].pts[j][1] - y) * m] as Pt), on: s.on + (b[k].on - s.on) * m }));

function Spinner({ activity }: { activity: Activity }) {
  const ref = useRef<SVGSVGElement>(null);
  const shown = useRef<Shape | null>(null);
  const [still, setStill] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setStill(true);
    const frames = ACTIVITIES[activity].frames;
    const shapes = frames.map((f) => shapeOf(f.d));
    const paths = [...(ref.current?.querySelectorAll("path") ?? [])];
    const MORPH = 280;
    const ENTER = 320;
    const morphOf = (k: number) => frames[k].morph ?? MORPH;
    const starts: number[] = [];
    let total = 0;
    frames.forEach((f, k) => {
      starts.push(total);
      total += f.ms + morphOf(k);
    });
    // Entering: from what is on screen (the previous activity) into this one's first frame.
    const entering = shown.current;
    let raf = 0;
    const t0 = performance.now();
    const draw = (shape: Shape) => {
      shown.current = shape;
      paths.forEach((el, k) => {
        el.setAttribute("d", toPath(shape[k].pts));
        el.setAttribute("opacity", String(shape[k].on));
      });
    };
    const tick = (now: number) => {
      const elapsed = now - t0;
      if (entering && elapsed < ENTER) {
        draw(mix(entering, shapes[0], ease(elapsed / ENTER)));
      } else {
        const t = (elapsed - (entering ? ENTER : 0)) % total;
        let i = starts.findIndex((st, k) => t >= st && t < (starts[k + 1] ?? total));
        if (i < 0) i = 0;
        const into = t - starts[i];
        const m = into <= frames[i].ms ? 0 : ease(Math.min(1, (into - frames[i].ms) / morphOf(i)));
        draw(mix(shapes[i], shapes[(i + 1) % shapes.length], m));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activity]);
  if (still) return <Glyph d={ACTIVITIES[activity].still} active />;
  return (
    <svg
      ref={ref}
      aria-hidden
      viewBox="0 0 24 24"
      width="1.15em"
      height="1.15em"
      fill="none"
      stroke="#d97757"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none", verticalAlign: "-0.2em" }}
    >
      {Array.from({ length: STROKES }, (_, k) => (
        <path key={k} />
      ))}
    </svg>
  );
}

// The prototype's legend: every activity, animated, with when it shows.
function GlyphLegend() {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {(Object.keys(ACTIVITIES) as Activity[]).map((key) => (
        <li key={key} style={{ display: "flex", gap: "0.6em", alignItems: "flex-start", padding: "0.3em 0" }}>
          <span style={{ fontSize: "1.3em", lineHeight: 1 }}>
            <Spinner activity={key} />
          </span>
          <span>
            <strong>{ACTIVITIES[key].label}</strong>
            <span style={{ display: "block", color: "var(--color-text-secondary)", fontSize: "0.92em" }}>{ACTIVITIES[key].when}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const COACH: Element = { what: "Coach IA (panneau)", sources: ["Votre CV de référence", "Votre Profil"], model: "claude-sonnet-5 (Bedrock eu-north-1)", tools: ["Recherche web (Perplexity)", "Lecture de page"], at: ago(8) };

function stubFor(path: string): Element[] {
  if (/^\/offres\//.test(path))
    return [
      { what: "Résumé de l'offre", sources: ["welcometothejungle.com"], model: "claude-haiku-4-5 (Bedrock eu-north-1)", tools: ["Lecture de page"], at: ago(1560) },
      { what: "Pourquoi ce Match Score", sources: ["Offre", "Votre CV de référence"], model: "règles Jobbbox (sans IA)", tools: ["Calcul du Match Score"] },
    ];
  if (/^\/recherches|^\/job-digests\/./.test(path))
    return [
      { what: "Offres trouvées", sources: ["France Travail", "Fantastic.jobs", "Perplexity (recherche web)", "Sites carrières (Greenhouse, Lever)"], model: "sonar (Perplexity)", tools: ["API France Travail", "API Fantastic.jobs", "Recherche web (Perplexity)", "API Greenhouse / Lever / Ashby", "Lecture de page"], at: ago(25) },
      { what: "Variantes de l'intitulé", sources: ["Vos critères de recherche"], model: "mistral-medium", at: ago(26) },
      { what: "Résumés des offres", sources: ["Pages des offres"], model: "claude-haiku-4-5 (Bedrock eu-north-1)", tools: ["Lecture de page"], at: ago(24) },
    ];
  if (/^\/candidatures\/[^/]+\/dossier/.test(path))
    return [
      { what: "Dossier entreprise", sources: ["Annuaire des entreprises (INSEE)", "Perplexity (recherche web)"], model: "anthropic.claude-opus-5 (Bedrock eu-north-1)", tools: ["API Recherche d'entreprises", "Recherche web (Perplexity)", "Actualités (Perplexity)"], at: ago(4360) },
    ];
  if (/^\/candidatures\/[^/]+\/documents/.test(path))
    return [
      { what: "CV adapté", sources: ["Votre CV de référence", "Offre"], model: "anthropic.claude-opus-5 (Bedrock eu-north-1)", at: ago(2895) },
      { what: "Lettre de motivation", sources: ["Votre CV de référence", "Offre"], model: "mistral-medium (consentement IA UE)", at: ago(2895) },
    ];
  if (/^\/candidatures\/[^/]+\/propositions|^\/profils\/[^/]+\/propositions/.test(path))
    return [{ what: "Propositions", sources: ["Votre Candidature", "Offre"], model: "claude-sonnet-5 (Bedrock eu-north-1)" }];
  if (/^\/candidatures\/./.test(path))
    return [{ what: "Résumé de l'offre", sources: ["Offre"], model: "claude-haiku-4-5 (Bedrock eu-north-1)" }];
  if (/^\/profils\/[^/]+\/ats-score/.test(path))
    return [
      { what: "Score ATS", sources: ["Votre CV de référence"], model: "règles Jobbbox (sans IA)" },
      { what: "Corrections proposées", sources: ["Votre CV de référence"], model: "claude-sonnet-5 (Bedrock eu-north-1)" },
    ];
  if (/^\/profils\/[^/]+(\/cv-de-reference|\/cv)?$/.test(path))
    return [{ what: "CV de référence (lecture du CV importé)", sources: ["Votre CV importé"], model: "mistral-medium (consentement IA UE)", at: ago(30240) }];
  return [];
}

const uniq = (xs: string[]) => [...new Set(xs)];

// Fixed to the viewport's foot, over the workspace column only (not the sidebar,
// not the docked Coach Panel): left and width follow .workspace, see useWorkspaceBox.
const bar: CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: "var(--proto-bar-left, 0px)",
  width: "var(--proto-bar-width, 100%)",
  boxSizing: "border-box",
  zIndex: 10,
  background: "var(--color-background)",
  borderTop: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
};

function VariantA({ elements }: { elements: Element[] }) {
  const ai = elements.filter((e) => e.model && !e.model.startsWith("règles"));
  if (ai.length === 0) return null;
  const sources = uniq(elements.flatMap((e) => e.sources)).join(", ");
  const models = uniq(ai.map((e) => e.model!)).join(", ");
  const tools = uniq(elements.flatMap((e) => e.tools ?? [])).join(", ");
  return (
    <div style={{ ...bar, fontSize: "9px", lineHeight: 1.4, padding: "2px 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`Sources : ${sources} · Modèles : ${models} · Outils : ${tools}`}>
      Sources : {sources} · Modèles : {models} · Outils : {tools}
    </div>
  );
}

function VariantB({ elements }: { elements: Element[] }) {
  const [open, setOpen] = useState(false);
  if (elements.length === 0) return null;
  const models = uniq(elements.filter((e) => e.model).map((e) => e.model!.split(" ")[0])).join(", ");
  return (
    <div style={{ ...bar, fontSize: "0.875rem", padding: "var(--space-2) var(--space-4)" }}>
      <button type="button" className="button button-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⓘ Contenu produit avec l'IA · {models} {open ? "▾" : "▸"}
      </button>
      {open ? (
        <table style={{ width: "100%", fontSize: "0.875rem", marginTop: "var(--space-2)", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th>Élément</th>
              <th>Sources</th>
              <th>Modèle</th>
              <th>Outils</th>
              <th>Produit</th>
            </tr>
          </thead>
          <tbody>
            {elements.map((e) => (
              <tr key={e.what} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td>{e.what}</td>
                <td>{e.sources.join(", ")}</td>
                <td>{e.model ?? "—"}</td>
                <td>{e.tools?.join(", ") ?? "—"}</td>
                <td>{when(e.at) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function VariantC({ elements }: { elements: Element[] }) {
  const [shown, setShown] = useState<string | null>(null);
  if (elements.length === 0) return null;
  const detail = elements.find((e) => e.what === shown);
  return (
    <div style={{ ...bar, fontSize: "9px", lineHeight: 1.5, padding: "2px 8px" }}>
      {detail ? (
        <div style={{ padding: "4px 0", borderBottom: "1px solid var(--color-border)" }}>
          <strong>{detail.what}</strong> — Sources : {detail.sources.join(", ")} · Modèle : {detail.model ?? "—"}
          {detail.at ? ` · ${when(detail.at)}` : ""}
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
        {elements.map((e) => (
          <button
            key={e.what}
            type="button"
            onClick={() => setShown(shown === e.what ? null : e.what)}
            aria-expanded={shown === e.what}
            style={{ font: "inherit", color: "inherit", background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline dotted" }}
          >
            <Logo label={e.model ?? e.what} /> {e.what} : {e.model?.split(" ")[0] ?? "—"}
          </button>
        ))}
      </div>
    </div>
  );
}

// Logos: the site's own /favicon.ico, straight from the browser (PROTOTYPE: in
// production this leaks the Candidate's IP to each site, so they would be served
// from our own assets). A label with no known site gets a letter or a glyph.
const LOGOS: [RegExp, string][] = [
  [/claude|anthropic/i, "anthropic.com"],
  [/mistral/i, "mistral.ai"],
  [/sonar|perplexity|actualités/i, "perplexity.ai"],
  [/france travail/i, "francetravail.fr"],
  [/fantastic/i, "fantastic.jobs"],
  [/welcometothejungle/i, "www.welcometothejungle.com"],
  [/annuaire|recherche d'entreprises|insee/i, "annuaire-entreprises.data.gouv.fr"],
];
const GLYPHS: [RegExp, string][] = [
  [/cv|profil|candidature|critères/i, "👤"],
  [/lecture de page|pages des offres|offre$|^offre/i, "🌐"],
  [/règles|match score/i, "J"],
  [/greenhouse|lever|ashby|carrières/i, "🏢"],
];

function Logo({ label }: { label: string }) {
  const [failed, setFailed] = useState(false);
  const domain = LOGOS.find(([re]) => re.test(label))?.[1];
  const box: CSSProperties = { width: "1.15em", height: "1.15em", flex: "none", borderRadius: 3, verticalAlign: "-0.2em", display: "inline-flex", alignItems: "center", justifyContent: "center" };
  if (domain && !failed)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`https://${domain}/favicon.ico`} alt="" style={box} onError={() => setFailed(true)} />;
  const glyph = GLYPHS.find(([re]) => re.test(label))?.[1] ?? label.trim()[0]?.toUpperCase();
  return (
    <span aria-hidden style={{ ...box, background: "var(--color-border)", fontSize: "0.75em", fontWeight: 600 }}>
      {glyph}
    </span>
  );
}

// Bedrock models get AWS's logo beside the model's own.
// The links behind a label, stubbed: what the stored result would keep (a source's
// page, the offers read, a model's documentation). Shown on hover or focus.
const LINKS: [RegExp, string[]][] = [
  [/claude-haiku/i, ["https://docs.anthropic.com/en/docs/about-claude/models", "https://aws.amazon.com/bedrock/claude/"]],
  [/claude/i, ["https://docs.anthropic.com/en/docs/about-claude/models", "https://aws.amazon.com/bedrock/claude/"]],
  [/mistral/i, ["https://docs.mistral.ai/getting-started/models/"]],
  [/sonar/i, ["https://docs.perplexity.ai/models/models/sonar"]],
  [/france travail/i, ["https://francetravail.io/data/api/offres-emploi"]],
  [/fantastic/i, ["https://fantastic.jobs/api"]],
  [/perplexity|recherche web/i, ["https://www.perplexity.ai"]],
  [/annuaire|recherche d'entreprises/i, ["https://annuaire-entreprises.data.gouv.fr"]],
  [/welcometothejungle/i, ["https://www.welcometothejungle.com/fr/jobs"]],
  [/greenhouse|lever|ashby|carrières/i, ["https://boards.greenhouse.io", "https://jobs.lever.co", "https://jobs.ashbyhq.com"]],
  [/pages des offres|lecture de page/i, ["https://www.welcometothejungle.com/fr/jobs", "https://candidat.francetravail.fr/offres/recherche", "https://boards.greenhouse.io"]],
];
const linksOf = (label: string) => LINKS.find(([re]) => re.test(label))?.[1] ?? [];

// Hover (or keyboard focus) shows the label's links, clickable, in a small card.
function WithLinks({ label, children }: { label: string; children: ReactNode }) {
  const [shown, setShownState] = useState(false);
  const links = linksOf(label);
  // One card at a time: opening one closes the others.
  const me = useRef(Symbol(label));
  useEffect(() => {
    const close = (event: Event) => {
      if ((event as CustomEvent).detail !== me.current) setShownState(false);
    };
    window.addEventListener("proto-link-card", close);
    return () => window.removeEventListener("proto-link-card", close);
  }, []);
  const setShown = (value: boolean) => {
    if (value) window.dispatchEvent(new CustomEvent("proto-link-card", { detail: me.current }));
    setShownState(value);
  };
  if (!links.length) return <>{children}</>;
  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setShown(false);
      }}
    >
      <span tabIndex={0} style={{ textDecoration: "underline dotted", textUnderlineOffset: "0.2em", cursor: "default" }}>
        {children}
      </span>
      {shown ? (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            gap: "0.2em",
            width: "max-content",
            maxWidth: "19em",
            padding: "0.4em 0.6em",
            background: "var(--color-background)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            boxShadow: "var(--shadow-menu)",
          }}
        >
          {links.map((href) => (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere", fontSize: "0.9em" }}>
              {href.replace(/^https:\/\//, "")} ↗
            </a>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function Labelled({ label, mono: isMono, links }: { label: string; mono?: boolean; links?: boolean }) {
  const inner = (
    <span style={{ display: "inline-flex", gap: "0.4em", alignItems: "center" }}>
      <Logo label={label} />
      {/bedrock/i.test(label) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="https://aws.amazon.com/favicon.ico" alt="" style={{ width: "1.15em", height: "1.15em", borderRadius: 3 }} />
      ) : null}
      <span style={isMono ? mono : undefined}>{label}</span>
    </span>
  );
  // Links are shown for sources only, never for models or tools.
  return links ? <WithLinks label={label}>{inner}</WithLinks> : inner;
}

const short = (model?: string) => model?.split(" ")[0] ?? "—";

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section style={{ borderTop: "1px solid var(--color-border)", padding: "0.5em 0" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{ font: "inherit", width: "100%", display: "flex", justifyContent: "space-between", background: "none", border: 0, padding: "0.25em 0", margin: 0, minHeight: 0, cursor: "pointer", color: "var(--color-text-secondary)", textAlign: "left" }}
      >
        <span>
          {open ? "▾" : "▸"} {title}
        </span>
        <span>{count}</span>
      </button>
      {open ? <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{children}</ul> : null}
    </section>
  );
}

const mono: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.95em" };
const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "1em", padding: "0.2em 0" };
const dim: CSSProperties = { color: "var(--color-text-secondary)" };

// What a value is used by, for the right-hand column of a summary row.
const usedBy = (elements: Element[], has: (e: Element) => boolean) => elements.filter(has).map((e) => e.what).join(", ");

// « Arrêter » in the tasks: the stop icon alone, named by aria-label and a tooltip (the user's request).
function StopButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title="Arrêter"
      style={{ flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.7em", height: "1.7em", padding: 0, background: "var(--color-background)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--color-text)" }}
    >
      <span aria-hidden style={{ width: "0.6em", height: "0.6em", background: "currentColor", borderRadius: 1 }} />
    </button>
  );
}

function VariantD({ elements, tiny, run, coach, onStop }: { elements: Element[]; tiny: boolean; run: Run; coach: CoachLive; onStop: () => void }) {
  const [open, setOpen] = useState(true);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // Mount the toggle in the top bar, just before « Mon coach » (prototype hack).
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;
    const span = document.createElement("span");
    // display: contents, so the button is laid out as the top bar's own child,
    // with the same frame, height and alignment as « Mon coach ».
    span.style.display = "contents";
    topbar.insertBefore(span, topbar.lastElementChild);
    setSlot(span);
    return () => span.remove();
  }, []);
  useEffect(() => {
    // The page column makes room for the pane, as it does for the docked Coach Panel.
    const main = document.querySelector<HTMLElement>(".workspace > main");
    if (!main || !open || window.innerWidth < 1024) return;
    main.style.paddingRight = "calc(min(22rem, 90vw) + 2rem + var(--space-2))";
    return () => {
      main.style.paddingRight = "";
    };
  }, [open]);
  const models = uniq(elements.filter((e) => e.model).map((e) => e.model!));
  // Tokens per model: the page's stored content plus what the running action has spent so far.
  const tokensOf = (m: string) =>
    elements.filter((e) => e.model === m).reduce((n, e) => n + (e.tokens ?? 0), 0) +
    run.log.filter((x) => x.model === m).reduce((n, x) => n + (x.tokens ?? 0), 0);
  const runModels = uniq(run.log.filter((x) => x.model).map((x) => x.model!)).filter((m) => !models.includes(m));
  const allModels = [...models, ...runModels];
  const total = allModels.reduce((n, m) => n + tokensOf(m), 0);
  const msOf = (m: string) =>
    elements.filter((e) => e.model === m).reduce((n, e) => n + (e.ms ?? 0), 0) +
    run.log.filter((x) => x.model === m).reduce((n, x) => n + x.ms, 0);
  const totalMs = allModels.reduce((n, m) => n + msOf(m), 0);
  const toolMs = (t: string) =>
    (elements.some((e) => e.tools?.includes(t)) ? (TOOL_MS[t] ?? 1000) : 0) +
    run.log.filter((x) => x.tool === t && !x.model).reduce((n, x) => n + x.ms, 0);
  const runTools = uniq(run.log.filter((x) => x.tool).map((x) => x.tool!));
  // What the run is doing now: the first step not yet finished.
  const pageStep = run.running ? RUNS[run.kind].steps[run.log.length] : undefined;
  const coachStage = coach?.stages[coach.stages.length - 1];
  // The glyph follows the page's action, or else the Coach's reply on its way.
  const current = pageStep ?? (coachStage ? { activity: coachStage.activity, doing: `Coach : ${coachStage.doing.charAt(0).toLowerCase()}${coachStage.doing.slice(1)}` } : undefined);
  const sources = uniq(elements.flatMap((e) => e.sources));
  const tools = uniq([...elements.flatMap((e) => e.tools ?? []), ...runTools]);
  // Closed, the words of what the icon shows sit left of its frame, outside it.
  const words = current ? `${current.doing}…` : allModels.length ? `${allModels.length} modèle${allModels.length > 1 ? "s" : ""} · ${both(total, totalMs)}` : "Sources et IA";
  const toggle = (
    <>
    {!open ? (
      <span
        onClick={() => setOpen(true)}
        style={{ marginLeft: "auto", maxWidth: "18rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#9b9a97" /* light grey, no token: under AA contrast, see ADR-0009 */, fontSize: "0.8125rem", cursor: "pointer" }}
      >
        {words}
      </span>
    ) : null}
    {/* Closed, while something runs: its stop icon beside the words (the user's request; #316 had none here). */}
    {!open && current ? (
      <StopButton
        onClick={pageStep ? onStop : () => window.dispatchEvent(new Event("proto-coach-stop"))}
        label={`Arrêter : ${current.doing}`}
      />
    ) : null}
    <button
      id="proto-tasks-toggle"
      type="button"
      className="button"
      aria-expanded={open}
      aria-controls="proto-provenance-pane"
      // Icon only, as asked: the name lives in aria-label and the tooltip (ADR-0009 wants a visible label: to settle in #317).
      aria-label={current ? `En cours : ${current.doing}` : "Sources, modèles et outils de cette page"}
      title={current ? `${current.doing}…` : "Sources, modèles et outils"}
      onClick={() => setOpen(!open)}
      // Same box as .topbar .coach-panel-toggle: no shrinking, the control height, square.
      style={{ marginLeft: open ? "auto" : 0, flex: "none", minHeight: "var(--control-height)", minWidth: "var(--control-height)", padding: "0 var(--space-3)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      {current ? <Spinner activity={current.activity} /> : <Glyph d={TASKS} />}
    </button>
    </>
  );
  return (
    <>
      {slot ? createPortal(toggle, slot) : null}
      {/* The pane and the docked Coach Panel float as cards with the notices' radius
          (--radius-md), inset by --space-2 (the user's request); the real change
          would go to .coach-panel in app.css. */}
      <style>{`@media (width >= 64rem) {
        .coach-panel:not(.coach-panel-wide) { top: var(--space-2); right: var(--space-2); bottom: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; }
        .with-coach-panel { margin-right: calc(var(--coach-width) + var(--space-2)); }
        /* Its header ends on the top bar's line: the card starts --space-2 lower, so the header is that much shorter. */
        .coach-panel:not(.coach-panel-wide) .coach-panel-header { box-sizing: border-box; min-height: 0; height: calc(var(--proto-topbar-height, 3.5rem) - var(--space-2) - 1px); padding-block: 0; }
      }
      /* The sidebar's Usage Meter detail (the user's request): smaller, and opened
         upward as a card above the meter, so the sidebar's foot does not grow down.
         The real change would go to .usage-meter-detail in app.css. */
      .usage-meter { position: relative; }
      .usage-meter-detail {
        position: absolute; left: var(--space-2); right: var(--space-2); bottom: calc(100% + var(--space-1)); z-index: 5;
        padding: var(--space-2) var(--space-3); font-size: 0.8125rem; line-height: 1.4;
        background: var(--color-background); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-menu);
      }
      .usage-meter-detail dl { gap: 2px; margin-bottom: var(--space-1); }
      .usage-meter-detail .hint { margin-bottom: var(--space-1); font-size: inherit; }
      .usage-meter-renews { margin-top: calc(-1 * var(--space-1)); font-size: 0.75rem; font-weight: 400; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      /* The pane's scrollbar shows only while the pointer is over it or it scrolls. */
      #proto-provenance-pane { scrollbar-width: thin; scrollbar-color: transparent transparent; }
      #proto-provenance-pane:hover, #proto-provenance-pane.proto-scrolling { scrollbar-color: var(--color-text-secondary) transparent; }
      /* The top bar's last button ends where the pane ends: --space-2 from the column's edge. */
      .topbar { padding-right: var(--space-2); }`}</style>
      {open ? (
        <aside
          id="proto-provenance-pane"
          onScroll={(event) => {
            const pane = event.currentTarget;
            pane.classList.add("proto-scrolling");
            window.clearTimeout(Number(pane.dataset.scrollTimer));
            pane.dataset.scrollTimer = String(window.setTimeout(() => pane.classList.remove("proto-scrolling"), 800));
          }}
          aria-label="Sources, modèles et outils de cette page"
          style={{
            position: "fixed",
            top: "calc(var(--proto-bar-top, 4rem) + var(--space-2))",
            bottom: "var(--space-2)",
            right: "calc(var(--proto-bar-right, 0px) + var(--space-2))",
            width: "min(22rem, 90vw)",
            overflowY: "auto",
            zIndex: 15,
            boxSizing: "border-box",
            padding: "0.75em 1em 4em",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            fontSize: tiny ? "9px" : "calc(0.8125rem - 1px)",
            lineHeight: 1.45,
          }}
        >
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: "0.5em" }}>
            <strong>Cette page</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" style={{ font: "inherit", background: "none", border: 0, cursor: "pointer", ...dim }}>
              ✕
            </button>
          </header>
          {coach ? (
            <section aria-live="polite" style={{ padding: "0.5em 0", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ ...row, color: "var(--color-text-secondary)" }}>
                <span>
                  {coachStage ? <Spinner activity={coachStage.activity} /> : null} Coach : réponse en cours
                </span>
                <StopButton onClick={() => window.dispatchEvent(new Event("proto-coach-stop"))} label="Arrêter la réponse du Coach" />
              </div>
              <div style={{ ...dim, fontSize: "0.92em", padding: "0.1em 0 0.3em" }}>« {coach.question} »</div>
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {coach.stages.map((x, k) => (
                  <li key={x.doing} style={{ ...row, justifyContent: "flex-start", gap: "0.4em", animation: "proto-fade-in 300ms ease-out" }}>
                    {k === coach.stages.length - 1 ? <Spinner activity={x.activity} /> : <span style={{ width: "1.15em", textAlign: "center" }}>✓</span>}
                    <span>{x.doing}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {run.running || run.log.length ? (
            <section
              aria-live="polite"
              // Stopped or failed: highlighted in a very light red (the user's request), said in words too.
              style={
                run.stoppedAt || run.failed
                  ? { padding: "0.5em 0.6em", margin: "0.3em -0.6em", background: "var(--color-danger-surface)", borderRadius: "var(--radius-sm)" }
                  : { padding: "0.5em 0" }
              }
            >
              <div style={{ ...row, color: "var(--color-text-secondary)" }}>
                <span>
                  {pageStep ? <Spinner activity={pageStep.activity} /> : run.failed ? "✕" : run.stoppedAt ? "■" : "✓"}{" "}
                  {run.running
                    ? RUNS[run.kind].live
                    : run.failed
                      ? `${RUNS[run.kind].failed} à ${when(run.failed.at)}`
                      : run.stoppedAt
                        ? `${RUNS[run.kind].stopped} à ${when(run.stoppedAt)}`
                        : RUNS[run.kind].done}
                </span>
                {run.running ? <StopButton onClick={onStop} label={`Arrêter : ${RUNS[run.kind].live}`} /> : null}
                <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                  {both(run.log.reduce((n, x) => n + (x.tokens ?? 0), 0), run.log.reduce((n, x) => n + x.ms, 0))}
                </span>
              </div>
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {run.log.map((x) => (
                  <li key={x.text} style={{ ...row, animation: "proto-fade-in 300ms ease-out" }}>
                    <span style={{ display: "inline-flex", gap: "0.4em", alignItems: "flex-start" }}>
                      <Logo label={x.model ?? x.logo} />
                      <span>
                        {x.text}
                        {x.model ? <span style={{ ...mono, ...dim, display: "block", fontSize: "0.85em" }}>{short(x.model)}</span> : null}
                      </span>
                    </span>
                    <span style={{ ...dim, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                      {both(x.tokens ?? 0, x.ms)} · {when(x.at)}
                    </span>
                  </li>
                ))}
                {run.failed ? (
                  <li style={{ ...row, color: "var(--color-danger)" }}>
                    <span style={{ display: "inline-flex", gap: "0.4em", alignItems: "flex-start" }}>
                      <Logo label={run.failed.step.model ?? run.failed.step.logo} />
                      <span>
                        {run.failed.step.doing} : échec
                        <span style={{ display: "block", fontSize: "0.9em" }}>{run.failed.reason}</span>
                      </span>
                    </span>
                    <span style={{ whiteSpace: "nowrap" }}>{when(run.failed.at)}</span>
                  </li>
                ) : null}
                {run.running ? (
                  <li style={{ ...dim, padding: "0.2em 0" }}>
                    {current ? (
                      <>
                        <Spinner activity={current.activity} /> {current.doing}…
                      </>
                    ) : null}
                  </li>
                ) : null}
              </ol>
              <style>{`@keyframes proto-fade-in { from { opacity: 0; transform: translateY(-2px) } } @media (prefers-reduced-motion: reduce) { [style*="proto-fade-in"] { animation: none !important } }`}</style>
            </section>
          ) : null}
          {elements.length === 0 && !run.log.length ? (
            <p style={dim}>Aucun contenu produit par l'IA sur cette page.</p>
          ) : (
            <>
              <Section title="Modèles" count={allModels.length}>
                {allModels.map((m) => (
                  <li key={m} style={row}>
                    <Labelled label={m} mono />
                    <span style={{ ...dim, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                      {both(tokensOf(m), msOf(m)) || "—"}
                    </span>
                  </li>
                ))}
                <li style={{ ...row, borderTop: "1px solid var(--color-border)", marginTop: "0.3em", paddingTop: "0.4em" }}>
                  <strong>Total</strong>
                  <strong style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                    {both(total, totalMs)}
                  </strong>
                </li>
              </Section>
              <Section title="Sources" count={sources.length}>
                {sources.map((x) => (
                  <li key={x} style={row}>
                    <Labelled label={x} links />
                  </li>
                ))}
              </Section>
              <Section title="Outils" count={tools.length}>
                {tools.map((x) => (
                  <li key={x} style={{ padding: "0.2em 0" }}>
                    <div style={row}>
                      <Labelled label={x} />
                      <span style={{ ...dim, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{toolMs(x) ? dur(toolMs(x)) : ""}</span>
                    </div>
                    <div style={{ ...dim, fontSize: "0.9em", paddingLeft: "1.55em" }}>{usedBy(elements, (e) => e.tools?.includes(x) ?? false)}</div>
                  </li>
                ))}
              </Section>
              <Section title="Icône pendant une action (prototype)" count={7}>
                <li>
                  <GlyphLegend />
                </li>
              </Section>
              <Section title="Par élément" count={elements.length}>
                {elements.map((e) => (
                  <li
                    key={e.what}
                    style={
                      e.what.includes("(arrêtée)")
                        ? { padding: "0.4em 0.6em", margin: "0.2em -0.6em", background: "var(--color-danger-surface)", borderRadius: "var(--radius-sm)" }
                        : { padding: "0.4em 0" }
                    }
                  >
                    <div style={row}>
                      <strong>{e.what}</strong>
                      <span style={dim}>{when(e.at)}</span>
                    </div>
                    <Labelled label={short(e.model)} mono />
                    <div style={{ ...dim, display: "flex", flexWrap: "wrap", gap: "0.2em 0.5em", marginTop: "0.2em" }} title={[...e.sources, ...(e.tools ?? [])].join(" · ")}>
                      {uniq([...e.sources, ...(e.tools ?? [])]).map((x) => (
                        <Logo key={x} label={x} />
                      ))}
                    </div>
                  </li>
                ))}
              </Section>
            </>
          )}
        </aside>
      ) : null}
    </>
  );
}

const VARIANTS = { A: "9 px, une ligne par page", B: "lisible, repliable, tableau", C: "9 px, par élément", D: "panneau de session, à droite" } as const;
type Key = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as Key[];

function useWorkspaceBox() {
  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>(".workspace");
    if (!workspace) return;
    const update = () => {
      const box = workspace.getBoundingClientRect();
      document.documentElement.style.setProperty("--proto-bar-left", `${box.left}px`);
      document.documentElement.style.setProperty("--proto-bar-width", `${box.width}px`);
      document.documentElement.style.setProperty("--proto-bar-right", `${window.innerWidth - box.right}px`);
      const topbar = workspace.querySelector(".topbar")?.getBoundingClientRect();
      if (topbar) {
        document.documentElement.style.setProperty("--proto-bar-top", `${topbar.bottom}px`);
        document.documentElement.style.setProperty("--proto-topbar-height", `${topbar.height}px`);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(workspace);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
}

// The Coach's replies, as the tasks pane sees them: the one on its way (its stages so
// far) and those done, which join the page's elements and totals.
type CoachLive = { question: string; stages: ReplyStage[] } | null;
function useCoachFeed() {
  const [live, setLive] = useState<CoachLive>(null);
  const [done, setDone] = useState<(ProtoReplyResult & { question: string })[]>([]);
  useEffect(() => {
    const step = (event: Event) => {
      const { question, stage, index } = (event as CustomEvent<{ question: string; stage: ReplyStage; index: number }>).detail;
      setLive((l) => ({ question, stages: index === 0 || !l || l.question !== question ? [stage] : [...l.stages.slice(0, index), stage] }));
    };
    const finish = (event: Event) => {
      const detail = (event as CustomEvent<ProtoReplyResult & { question: string }>).detail;
      setLive(null);
      setDone((d) => [...d, detail]);
    };
    window.addEventListener("proto-coach-step", step);
    window.addEventListener("proto-coach-done", finish);
    return () => {
      window.removeEventListener("proto-coach-step", step);
      window.removeEventListener("proto-coach-done", finish);
    };
  }, []);
  return { live, done };
}

// Two exchanges in turn: a plain question, then one that makes the Coach search the web.
const COACH_DEMOS = [
  { question: "Comment présenter ma reconversion dans ma lettre ?", reply: "Commencez par ce qui relie vos deux métiers : la gestion d'équipe et le pilotage budgétaire. Puis dites en une phrase pourquoi vous changez, sans vous justifier.", ms: 4600 },
  { question: "Trouve-moi des entreprises qui recrutent des directeurs financiers à Lyon.", reply: "J'en ai trouvé trois qui publient en ce moment : un groupe de distribution, une ETI industrielle et une scale-up de la santé. Voulez-vous que je lance une recherche d'offres sur votre profil ?", ms: 8200 },
];
let coachDemoTurn = 0;
function coachDemo() {
  window.dispatchEvent(new CustomEvent("proto-coach-demo", { detail: COACH_DEMOS[coachDemoTurn++ % COACH_DEMOS.length] }));
}

export function PrototypeAiProvenanceBar() {
  useWorkspaceBox();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("variant");
  const variant: Key = raw && raw in VARIANTS ? (raw as Key) : "D";
  const withCoach = params.get("coach") === "1";
  shiftDays = params.get("lendemain") === "1" ? 1 : 0;
  const coach = useCoachFeed();
  // The page's own content, combined with what the Coach answered on it.
  const coachElements: Element[] = coach.done.map((r) => ({
    what: `Coach IA${r.stopped ? " (arrêtée)" : ""} · « ${r.question.length > 38 ? `${r.question.slice(0, 38)}…` : r.question} »`,
    sources: r.sources,
    model: r.model,
    tools: r.tools,
    at: r.at,
    tokens: r.tokens,
    ms: r.ms,
  }));
  const elements = withTokens([...stubFor(pathname), ...(withCoach ? [COACH] : []), ...coachElements]);
  const runParam = params.get("run");
  const { run, start, stop } = useSimulatedRun(runParam === "1" ? "search" : runParam === "docs" ? "docs" : null);

  const go = (step: number) => {
    const next = KEYS[(KEYS.indexOf(variant) + step + KEYS.length) % KEYS.length];
    const q = new URLSearchParams(params.toString());
    q.set("variant", next);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;
  return (
    <>
      {variant === "A" ? <VariantA elements={elements} /> : null}
      {variant === "B" ? <VariantB elements={elements} /> : null}
      {variant === "C" ? <VariantC elements={elements} /> : null}
      {variant === "D" ? <VariantD elements={elements} tiny={params.get("size") === "9"} run={run} coach={coach.live} onStop={stop} /> : null}
      <div
        style={{ position: "fixed", left: "50%", bottom: 64, transform: "translateX(-50%)", zIndex: 50, display: "flex", gap: 8, alignItems: "center", padding: "6px 12px", borderRadius: 999, background: "#111", color: "#fff", fontSize: 14, boxShadow: "0 4px 16px rgb(0 0 0 / 30%)" }}
      >
        <button type="button" onClick={() => go(-1)} style={{ color: "inherit", background: "none", border: 0, cursor: "pointer" }}>
          ←
        </button>
        <span>
          PROTOTYPE {variant} ({VARIANTS[variant]}) · {elements.length} élément(s)
        </span>
        {variant === "D" ? (
          <>
            <button type="button" onClick={() => start("search")} disabled={run.running} style={{ color: "inherit", background: "#333", border: 0, borderRadius: 999, padding: "2px 10px", cursor: "pointer" }}>
              ▶ recherche
            </button>
            <button type="button" onClick={() => start("docs")} disabled={run.running} style={{ color: "inherit", background: "#333", border: 0, borderRadius: 999, padding: "2px 10px", cursor: "pointer" }}>
              ▶ documents
            </button>
            <button type="button" onClick={coachDemo} style={{ color: "inherit", background: "#333", border: 0, borderRadius: 999, padding: "2px 10px", cursor: "pointer" }}>
              ▶ coach
            </button>
            <button type="button" onClick={() => start("search", 3)} disabled={run.running} style={{ color: "inherit", background: "#333", border: 0, borderRadius: 999, padding: "2px 10px", cursor: "pointer" }}>
              ▶ échec
            </button>
          </>
        ) : null}
        <button type="button" onClick={() => go(1)} style={{ color: "inherit", background: "none", border: 0, cursor: "pointer" }}>
          →
        </button>
      </div>
    </>
  );
}

/*
 * PROTOTYPE — the Coach Panel and the Back Office Assistant: before each reply,
 * the glyph of what the AI is doing now; after each reply, the run's results.
 * Stubbed: the real model and tokens are on coach_message, the steps are not
 * sent yet (#319).
 */
type ReplyStage = { activity: Activity; doing: string; ms: number };
const REPLY_STAGES: ReplyStage[] = [
  { activity: "read", doing: "Lecture de ce que vous consultez", ms: 1200 },
  { activity: "think", doing: "Réflexion (claude-sonnet-5)", ms: 1800 },
  { activity: "thinkWrite", doing: "Rédaction de la réponse", ms: 99_000 },
];
const REPLY_STAGES_SEARCH: ReplyStage[] = [
  { activity: "read", doing: "Lecture de votre profil", ms: 1000 },
  { activity: "think", doing: "Réflexion (claude-sonnet-5)", ms: 1400 },
  { activity: "searchRead", doing: "Recherche web (sonar)", ms: 3200 },
  { activity: "thinkWrite", doing: "Rédaction de la réponse", ms: 99_000 },
];
const wantsSearch = (text: string) => /offre|cherche|trouve|entreprise|recrute|salaire/i.test(text);

export function PrototypeReplyActivity({ question }: { question: string }) {
  const stages = wantsSearch(question) ? REPLY_STAGES_SEARCH : REPLY_STAGES;
  const [i, setI] = useState(0);
  useEffect(() => {
    // The tasks pane follows the Coach: each stage is announced as it starts.
    window.dispatchEvent(new CustomEvent("proto-coach-step", { detail: { question, stage: stages[i], index: i } }));
    if (i >= stages.length - 1) return;
    const id = window.setTimeout(() => setI(i + 1), stages[i].ms);
    return () => window.clearTimeout(id);
  }, [i, stages, question]);
  if (process.env.NODE_ENV === "production") return null;
  const stage = stages[i];
  return (
    <span style={{ display: "inline-flex", gap: "0.5em", alignItems: "center", color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>
      <span style={{ fontSize: "1.2em", lineHeight: 1 }}>
        <Spinner activity={stage.activity} />
      </span>
      {stage.doing}…
    </span>
  );
}

export type ProtoReplyResult = { model: string; tokens: number; ms: number; tools: string[]; sources: string[]; at: number; stopped?: boolean };

// What a stopped reply had spent: the time it ran, and tokens in proportion (stubbed).
export function protoStoppedResult(question: string, ranMs: number): ProtoReplyResult {
  const full = protoResultFor(question);
  const part = Math.min(1, ranMs / full.ms);
  return { ...full, tokens: Math.round(full.tokens * part * 0.6), ms: ranMs, stopped: true };
}

export function protoResultFor(question: string): ProtoReplyResult {
  const search = wantsSearch(question);
  return {
    model: "claude-sonnet-5 (Bedrock eu-north-1)",
    tokens: search ? 6840 : 2310 + (question.length % 900),
    ms: search ? 8200 : 3400 + (question.length % 1500),
    tools: search ? ["Recherche web (Perplexity)", "Lecture de page"] : [],
    sources: search ? ["Votre Profil", "Pages des offres"] : ["Votre CV de référence"],
    at: Date.now(),
  };
}

// One quiet line under a reply: the model, its tokens and time, the tools, the hour.
export function PrototypeReplyResult({ result }: { result: ProtoReplyResult }) {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: "0.2em 0.6em", alignItems: "center", marginTop: "0.5em", color: "var(--color-text-secondary)", fontSize: "0.75rem" }}>
      <span style={{ display: "inline-flex", gap: "0.35em", alignItems: "center" }}>
        <Logo label={result.model} />
        <span style={mono}>{short(result.model)}</span>
      </span>
      <span>{both(result.tokens, result.ms)}</span>
      {result.stopped ? <span>arrêtée</span> : null}
      {result.tools.map((x) => (
        <span key={x} style={{ display: "inline-flex", gap: "0.3em", alignItems: "center" }}>
          <Logo label={x} />
          {x}
        </span>
      ))}
      {result.sources.map((x) => (
        <WithLinks key={x} label={x}>
          <span style={{ display: "inline-flex", gap: "0.3em", alignItems: "center" }}>
            <Logo label={x} />
            {x}
          </span>
        </WithLinks>
      ))}
      <span>{when(result.at)}</span>
    </span>
  );
}
