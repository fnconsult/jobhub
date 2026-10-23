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
  elements.map((e) => (e.model && !e.model.startsWith("règles") ? { ...e, tokens: TOKENS[e.what] ?? 1500, ms: MS[e.what] ?? 3000 } : e));
// Tokens, the k stuck to the number from 1 000 on: « 312 », « 2,1k », « 27,4k ».
const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: n < 100_000 ? 1 : 0 })}k`);
// Tokens and time on one line: « 2,1k · 6,4 s ».
const both = (tokens: number, ms: number) => [tokens ? fmt(tokens) : "", ms ? dur(ms) : ""].filter(Boolean).join(" · ");

// A simulated Job Search, as the pane would receive it live (SSE or polling).
type Step = { after: number; text: string; logo: string; model?: string; tool?: string; tokens?: number; ms: number; at?: number };
const RUN: Step[] = [
  { after: 400, text: "Variantes de l'intitulé", logo: "mistral", model: "mistral-medium", tokens: 312, ms: 790 },
  { after: 1400, text: "API France Travail · 18 offres", logo: "France Travail", tool: "API France Travail", ms: 1320 },
  { after: 2300, text: "API Fantastic.jobs · 10 offres", logo: "Fantastic.jobs", tool: "API Fantastic.jobs", ms: 2050 },
  { after: 3300, text: "Recherche web · 3 requêtes", logo: "Perplexity", model: "sonar (Perplexity)", tool: "Recherche web (Perplexity)", tokens: 2140, ms: 5600 },
  { after: 4600, text: "Lecture de page · 12 pages", logo: "Lecture de page", tool: "Lecture de page", ms: 8900 },
  { after: 5800, text: "Résumés des offres · 12", logo: "claude", model: "claude-haiku-4-5 (Bedrock eu-north-1)", tokens: 8420, ms: 13700 },
  { after: 6800, text: "Match Score · 40 offres classées", logo: "règles", tool: "Calcul du Match Score", ms: 160 },
];
export type Run = { running: boolean; log: Step[] };

function useSimulatedRun(autostart: boolean) {
  const [run, setRun] = useState<Run>({ running: false, log: [] });
  // Each start cancels the previous one's pending steps (Strict Mode runs effects twice).
  const timers = useRef<number[]>([]);
  const start = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    setRun({ running: true, log: [] });
    timers.current = RUN.map((step, i) =>
      window.setTimeout(() => setRun((r) => ({ running: i < RUN.length - 1, log: [...r.log, { ...step, at: Date.now() }] })), step.after),
    );
  };
  useEffect(() => {
    if (autostart) start();
    return () => timers.current.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { run, start };
}

// Line icons in the app's style (icons.tsx: 24 grid, stroke 1.5). At rest the
// button shows the tasks icon; during an action it plays brain → magnifier →
// feather → a book opening page by page. Under prefers-reduced-motion it stays
// on the tasks icon (ADR-0009).
const TASKS = ["M10 6h10M10 12h10M10 18h10", "M4 6l1.2 1.2L7.5 5", "M4 12l1.2 1.2 2.3-2.2", "M4 18l1.2 1.2 2.3-2.2"];
const BOOK_OPEN = ["M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1z", "M21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z"];
const FRAMES: { d: string[]; ms: number; morph?: number }[] = [
  // Brain: two hemispheres and the fold between them.
  {
    d: [
      "M12 5a3 3 0 0 0-5.6-1.2A3 3 0 0 0 4 8a3 3 0 0 0 .2 5A3 3 0 0 0 7 17.6 3 3 0 0 0 12 19z",
      "M12 5a3 3 0 0 1 5.6-1.2A3 3 0 0 1 20 8a3 3 0 0 1-.2 5 3 3 0 0 1-2.8 4.6A3 3 0 0 1 12 19z",
      "M12 5v14M8 9.5c1 0 2 .6 2 2M16 9.5c-1 0-2 .6-2 2",
    ],
    ms: 380,
  },
  // Magnifier (the Job Searches' icon).
  { d: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M20 20l-4-4"], ms: 380 },
  // Feather.
  { d: ["M20.2 3.8a6 6 0 0 0-8.5 0L5 10.5V19h8.5l6.7-6.7a6 6 0 0 0 0-8.5z", "M16 8L3 21", "M17.5 15H9"], ms: 380 },
  // A book: closed, opened, then three pages turning from right to left.
  { d: ["M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z", "M5 18a2 2 0 0 1 2-2h12"], ms: 260 },
  { d: BOOK_OPEN, ms: 200 },
  { d: [...BOOK_OPEN, "M12 6c2-1.6 4-2.4 6-2.6v14c-2 .2-4 1-6 2.6"], ms: 30, morph: 170 },
  { d: [...BOOK_OPEN, "M12 6c.4-1.8.9-3 1.4-4v14c-.5 1-1 2.2-1.4 4"], ms: 0, morph: 170 },
  { d: [...BOOK_OPEN, "M12 6c-2-1.6-4-2.4-6-2.6v14c2 .2 4 1 6 2.6"], ms: 30, morph: 120 },
  { d: BOOK_OPEN, ms: 0, morph: 120 },
  { d: [...BOOK_OPEN, "M12 6c2-1.6 4-2.4 6-2.6v14c-2 .2-4 1-6 2.6"], ms: 30, morph: 170 },
  { d: [...BOOK_OPEN, "M12 6c.4-1.8.9-3 1.4-4v14c-.5 1-1 2.2-1.4 4"], ms: 0, morph: 170 },
  { d: [...BOOK_OPEN, "M12 6c-2-1.6-4-2.4-6-2.6v14c2 .2 4 1 6 2.6"], ms: 30, morph: 120 },
  { d: BOOK_OPEN, ms: 0, morph: 120 },
  { d: [...BOOK_OPEN, "M12 6c2-1.6 4-2.4 6-2.6v14c-2 .2-4 1-6 2.6"], ms: 30, morph: 170 },
  { d: [...BOOK_OPEN, "M12 6c.4-1.8.9-3 1.4-4v14c-.5 1-1 2.2-1.4 4"], ms: 0, morph: 170 },
  { d: [...BOOK_OPEN, "M12 6c-2-1.6-4-2.4-6-2.6v14c2 .2 4 1 6 2.6"], ms: 30, morph: 120 },
  { d: BOOK_OPEN, ms: 0, morph: 120 },
  { d: BOOK_OPEN, ms: 260 },
];

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

// The glyph morphs from one stage to the next: every stage is split into its
// strokes, each stroke resampled into POINTS points (getPointAtLength), and the
// points interpolated frame by frame. Stages with fewer strokes pad with
// invisible ones, which fade in or out. No library (see #279's findings).
const POINTS = 40;
const STROKES = 5;
type Shape = { pts: [number, number][]; on: number }[];
let shapes: Shape[] | null = null;

function strokesOf(d: string[]) {
  return d.flatMap((path) => path.split(/(?=M)/).map((x) => x.trim()).filter(Boolean));
}

function resample(d: string, probe: SVGPathElement): [number, number][] {
  probe.setAttribute("d", d);
  const length = probe.getTotalLength();
  return Array.from({ length: POINTS }, (_, k) => {
    const point = probe.getPointAtLength((length * k) / (POINTS - 1));
    return [point.x, point.y];
  });
}

function shapesOnce(): Shape[] {
  if (shapes) return shapes;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.style.position = "absolute";
  svg.style.visibility = "hidden";
  svg.appendChild(probe);
  document.body.appendChild(svg);
  shapes = FRAMES.map(({ d }) => {
    const strokes = strokesOf(d).map((x) => ({ pts: resample(x, probe), on: 1 }));
    // Padding strokes sit, collapsed, on the stage's centre, so they grow out of it.
    while (strokes.length < STROKES) strokes.push({ pts: Array.from({ length: POINTS }, () => [12, 12] as [number, number]), on: 0 });
    return strokes.slice(0, STROKES);
  });
  svg.remove();
  return shapes;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const toPath = (pts: [number, number][]) => "M" + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L");

function Spinner() {
  const ref = useRef<SVGSVGElement>(null);
  const [still, setStill] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setStill(true);
    const all = shapesOnce();
    const paths = [...(ref.current?.querySelectorAll("path") ?? [])];
    // Each stage holds for its ms, then morphs into the next over MORPH ms.
    const MORPH = 280;
    const morphOf = (k: number) => FRAMES[k].morph ?? MORPH;
    const starts: number[] = [];
    let total = 0;
    FRAMES.forEach((f, k) => {
      starts.push(total);
      total += f.ms + morphOf(k);
    });
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) % total;
      let i = starts.findIndex((st, k) => t >= st && t < (starts[k + 1] ?? total));
      if (i < 0) i = 0;
      const into = t - starts[i];
      const from = all[i];
      const to = all[(i + 1) % all.length];
      const m = into <= FRAMES[i].ms ? 0 : ease(Math.min(1, (into - FRAMES[i].ms) / morphOf(i)));
      paths.forEach((el, k) => {
        const a = from[k];
        const b = to[k];
        const pts = a.pts.map(([x, y], j) => [x + (b.pts[j][0] - x) * m, y + (b.pts[j][1] - y) * m] as [number, number]);
        el.setAttribute("d", toPath(pts));
        el.setAttribute("opacity", String(a.on + (b.on - a.on) * m));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (still) return <Glyph d={TASKS} active />;
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

function VariantD({ elements, tiny, run }: { elements: Element[]; tiny: boolean; run: Run }) {
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
    main.style.paddingRight = "calc(min(22rem, 90vw) + 2rem)";
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
  const sources = uniq(elements.flatMap((e) => e.sources));
  const tools = uniq([...elements.flatMap((e) => e.tools ?? []), ...runTools]);
  const toggle = (
    <button
      type="button"
      className="button"
      aria-expanded={open}
      aria-controls="proto-provenance-pane"
      // Icon only, as asked: the name lives in aria-label and the tooltip (ADR-0009 wants a visible label: to settle in #317).
      aria-label={run.running ? "Recherche en cours : sources, modèles et outils" : "Sources, modèles et outils de cette page"}
      title={run.running ? "Recherche en cours…" : "Sources, modèles et outils"}
      onClick={() => setOpen(!open)}
      // Same box as .topbar .coach-panel-toggle: no shrinking, the control height, square.
      style={{ marginLeft: "auto", flex: "none", minHeight: "var(--control-height)", minWidth: "var(--control-height)", padding: "0 var(--space-3)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      {run.running ? <Spinner /> : <Glyph d={TASKS} />}
    </button>
  );
  return (
    <>
      {slot ? createPortal(toggle, slot) : null}
      {open ? (
        <aside
          id="proto-provenance-pane"
          aria-label="Sources, modèles et outils de cette page"
          style={{
            position: "fixed",
            top: "var(--proto-bar-top, 4rem)",
            bottom: 0,
            right: "var(--proto-bar-right, 0px)",
            width: "min(22rem, 90vw)",
            overflowY: "auto",
            zIndex: 15,
            boxSizing: "border-box",
            padding: "0.75em 1em 4em",
            background: "var(--color-surface)",
            borderLeft: "1px solid var(--color-border)",
            fontSize: tiny ? "9px" : "0.8125rem",
            lineHeight: 1.45,
          }}
        >
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: "0.5em" }}>
            <strong>Cette page</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" style={{ font: "inherit", background: "none", border: 0, cursor: "pointer", ...dim }}>
              ✕
            </button>
          </header>
          {run.running || run.log.length ? (
            <section aria-live="polite" style={{ padding: "0.5em 0" }}>
              <div style={{ ...row, color: "var(--color-text-secondary)" }}>
                <span>
                  {run.running ? <Spinner /> : "✓"} {run.running ? "Recherche d'offres en cours" : "Dernière recherche"}
                </span>
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
                {run.running ? (
                  <li style={{ ...dim, padding: "0.2em 0" }}>
                    <Spinner /> …
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
              <Section title="Par élément" count={elements.length}>
                {elements.map((e) => (
                  <li key={e.what} style={{ padding: "0.4em 0" }}>
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
      if (topbar) document.documentElement.style.setProperty("--proto-bar-top", `${topbar.bottom}px`);
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

export function PrototypeAiProvenanceBar() {
  useWorkspaceBox();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("variant");
  const variant: Key = raw && raw in VARIANTS ? (raw as Key) : "D";
  const withCoach = params.get("coach") === "1";
  shiftDays = params.get("lendemain") === "1" ? 1 : 0;
  const elements = withTokens([...stubFor(pathname), ...(withCoach ? [COACH] : [])]);
  const { run, start } = useSimulatedRun(params.get("run") === "1");

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
      {variant === "D" ? <VariantD elements={elements} tiny={params.get("size") === "9"} run={run} /> : null}
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
          <button type="button" onClick={start} disabled={run.running} style={{ color: "inherit", background: "#333", border: 0, borderRadius: 999, padding: "2px 10px", cursor: "pointer" }}>
            ▶ simuler
          </button>
        ) : null}
        <button type="button" onClick={() => go(1)} style={{ color: "inherit", background: "none", border: 0, cursor: "pointer" }}>
          →
        </button>
      </div>
    </>
  );
}
