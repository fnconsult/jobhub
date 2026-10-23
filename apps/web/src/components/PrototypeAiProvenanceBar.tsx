"use client";

/*
 * PROTOTYPE — throwaway, do not merge to main (wayfinder map "Sources et modèles IA").
 * Question: what should the bottom bar showing a Candidate page's sources and AI
 * models look like? Three variants, switched with ?variant=A|B|C or ← / →:
 *   A — the request as worded: one fixed line at 9 px, aggregated for the page.
 *   B — readable (ADR-0009): a 14 px collapsed line « Sources et IA » that opens
 *       a table, one row per AI-produced element.
 *   C — per element: 9 px segments, one per element, each opening its detail.
 * The data is STUBBED per route: no result table stores its model today
 * (only coach_message does), so nothing real can be shown yet.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";

type Element = { what: string; sources: string[]; model?: string; at?: string };

const COACH: Element = { what: "Coach IA (panneau)", sources: ["Votre CV de référence", "Votre Profil"], model: "claude-sonnet-5 (Bedrock eu-north-1)" };

function stubFor(path: string): Element[] {
  if (/^\/offres\//.test(path))
    return [
      { what: "Résumé de l'offre", sources: ["welcometothejungle.com"], model: "claude-haiku-4-5 (Bedrock eu-north-1)", at: "22/10/2026" },
      { what: "Pourquoi ce Match Score", sources: ["Offre", "Votre CV de référence"], model: "règles Jobbbox (sans IA)" },
    ];
  if (/^\/recherches|^\/job-digests\/./.test(path))
    return [
      { what: "Offres trouvées", sources: ["France Travail", "Fantastic.jobs", "Perplexity (recherche web)", "Sites carrières (Greenhouse, Lever)"], model: "sonar (Perplexity)", at: "23/10/2026" },
      { what: "Variantes de l'intitulé", sources: ["Vos critères de recherche"], model: "mistral-medium" },
      { what: "Résumés des offres", sources: ["Pages des offres"], model: "claude-haiku-4-5 (Bedrock eu-north-1)" },
    ];
  if (/^\/candidatures\/[^/]+\/dossier/.test(path))
    return [
      { what: "Dossier entreprise", sources: ["Annuaire des entreprises (INSEE)", "Perplexity (recherche web)"], model: "anthropic.claude-opus-5 (Bedrock eu-north-1)", at: "20/10/2026" },
    ];
  if (/^\/candidatures\/[^/]+\/documents/.test(path))
    return [
      { what: "CV adapté", sources: ["Votre CV de référence", "Offre"], model: "anthropic.claude-opus-5 (Bedrock eu-north-1)", at: "21/10/2026" },
      { what: "Lettre de motivation", sources: ["Votre CV de référence", "Offre"], model: "mistral-medium (consentement IA UE)", at: "21/10/2026" },
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
    return [{ what: "CV de référence (lecture du CV importé)", sources: ["Votre CV importé"], model: "mistral-medium (consentement IA UE)", at: "02/10/2026" }];
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
  return (
    <div style={{ ...bar, fontSize: "9px", lineHeight: 1.4, padding: "2px 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`Sources : ${sources} · Modèles : ${models}`}>
      Sources : {sources} · Modèles : {models}
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
              <th>Produit le</th>
            </tr>
          </thead>
          <tbody>
            {elements.map((e) => (
              <tr key={e.what} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td>{e.what}</td>
                <td>{e.sources.join(", ")}</td>
                <td>{e.model ?? "—"}</td>
                <td>{e.at ?? "—"}</td>
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
          {detail.at ? ` · le ${detail.at}` : ""}
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
            {e.what} : {e.model?.split(" ")[0] ?? "—"}
          </button>
        ))}
      </div>
    </div>
  );
}

const VARIANTS = { A: "9 px, une ligne par page", B: "lisible, repliable, tableau", C: "9 px, par élément" } as const;
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
  const variant: Key = raw && raw in VARIANTS ? (raw as Key) : "A";
  const withCoach = params.get("coach") === "1";
  const elements = [...stubFor(pathname), ...(withCoach ? [COACH] : [])];

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
      <div
        style={{ position: "fixed", left: "50%", bottom: 64, transform: "translateX(-50%)", zIndex: 50, display: "flex", gap: 8, alignItems: "center", padding: "6px 12px", borderRadius: 999, background: "#111", color: "#fff", fontSize: 14, boxShadow: "0 4px 16px rgb(0 0 0 / 30%)" }}
      >
        <button type="button" onClick={() => go(-1)} style={{ color: "inherit", background: "none", border: 0, cursor: "pointer" }}>
          ←
        </button>
        <span>
          PROTOTYPE {variant} ({VARIANTS[variant]}) · {elements.length} élément(s)
        </span>
        <button type="button" onClick={() => go(1)} style={{ color: "inherit", background: "none", border: 0, cursor: "pointer" }}>
          →
        </button>
      </div>
    </>
  );
}
