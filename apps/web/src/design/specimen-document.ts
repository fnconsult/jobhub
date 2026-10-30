import type { Block } from "@/export/layout";
import { renderPdf } from "@/export/pdf";
import { TEMPLATE_STYLES } from "@/export/templates";

const JOBS = [
  ["Directrice administrative et financière — Groupe Arvel, Lyon", "2018 – aujourd'hui"],
  ["Responsable du contrôle de gestion — Sorelia Industrie, Villeurbanne", "2012 – 2018"],
  ["Contrôleuse de gestion — Valmont Distribution, Grenoble", "2007 – 2012"],
  ["Auditrice financière — Cabinet Lemaire & Associés, Lyon", "2002 – 2007"],
] as const;

const MISSIONS = [
  "Pilotage du budget annuel et des prévisions trimestrielles de cinq filiales.",
  "Clôtures mensuelles en cinq jours ouvrés, consolidation aux normes IFRS.",
  "Mise en place d'un outil de reporting partagé avec les directions opérationnelles.",
  "Encadrement d'une équipe de huit personnes, recrutement et formation.",
  "Négociation des financements bancaires et suivi de la trésorerie du groupe.",
  "Préparation des comités d'audit et relations avec les commissaires aux comptes.",
];

/** A CV long enough to need two pages: the Viewer's specimen, for its test page and the e2e suite (#468). */
function specimenBlocks(): Block[] {
  const blocks: Block[] = [
    { kind: "name", text: "Marie Dupont" },
    { kind: "headline", text: "Directrice financière" },
    { kind: "contact", text: "marie.dupont@example.fr · 06 12 34 56 78 · Lyon" },
    { kind: "heading", text: "Profil" },
    { kind: "text", text: "Directrice financière, 25 ans d'expérience dans l'industrie et la distribution, du contrôle de gestion à la direction financière d'un groupe de cinq filiales." },
    { kind: "heading", text: "Expérience" },
  ];
  for (const [job, period] of JOBS) {
    blocks.push({ kind: "entry", text: job }, { kind: "text", text: period });
    for (const mission of MISSIONS) blocks.push({ kind: "text", text: `• ${mission}` });
    blocks.push({ kind: "gap" });
  }
  blocks.push(
    { kind: "heading", text: "Formation" },
    { kind: "entry", text: "Master Finance d'entreprise — IAE Lyon" },
    { kind: "text", text: "2002" },
    { kind: "heading", text: "Compétences" },
    { kind: "text", text: "IFRS · Consolidation · Contrôle de gestion · Trésorerie · Management d'équipe" },
  );
  return blocks;
}

/** The Viewer's specimen: a two-page CV as a PDF, as the export draws one. */
export async function specimenPdf(): Promise<{ fileName: string; bytes: Uint8Array }> {
  const fileName = "CV-Marie-Dupont.pdf";
  return { fileName, bytes: await renderPdf(specimenBlocks(), TEMPLATE_STYLES.modern, fileName) };
}
