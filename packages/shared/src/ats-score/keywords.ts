import { normalise } from "../text";

/**
 * Keywords applicant tracking systems look for, by family of target role, as
 * French CVs write them. A role is put in the first family one of whose
 * triggers starts a word of it (a trigger ending in a space must be the whole
 * word). Fixed rules, not an AI task, so the score is the same every time.
 */
const FAMILIES: { triggers: string[]; keywords: string[] }[] = [
  {
    triggers: ["financ", "daf ", "cfo ", "comptab", "controleur de gestion", "controleuse de gestion", "controle de gestion", "tresor", "audit"],
    keywords: ["Budget", "Reporting", "Contrôle de gestion", "Trésorerie", "Consolidation", "IFRS", "Clôture", "ERP"],
  },
  {
    triggers: ["ressources humaines", "rh ", "drh ", "talent", "recrut", "human resources", "hr "],
    keywords: ["Recrutement", "GPEC", "Paie", "Relations sociales", "Droit du travail", "Formation", "SIRH", "Gestion des talents"],
  },
  {
    triggers: ["dsi ", "informatique", "systemes d information", "cto ", "it ", "numerique", "digital", "data"],
    keywords: ["Transformation digitale", "Gestion de projet", "Cloud", "Cybersécurité", "Architecture", "Budget", "Agile", "ERP"],
  },
  {
    triggers: ["commercia", "vente", "business developer", "account manager", "sales", "grands comptes"],
    keywords: ["Développement commercial", "Prospection", "Négociation", "Grands comptes", "CRM", "Chiffre d'affaires", "Management d'équipe", "Fidélisation"],
  },
  {
    triggers: ["marketing", "communication", "brand", "marque"],
    keywords: ["Stratégie marketing", "Marketing digital", "Communication", "Étude de marché", "Lancement produit", "Budget", "SEO", "CRM"],
  },
  {
    triggers: ["operation", "supply chain", "logisti", "production", "industri", "usine", "achat", "qualite"],
    keywords: ["Supply chain", "Lean", "Amélioration continue", "Achats", "Logistique", "Qualité", "Budget", "Management d'équipe"],
  },
  {
    triggers: ["chef de projet", "cheffe de projet", "project manager", "pmo ", "directeur de programme", "directrice de programme"],
    keywords: ["Gestion de projet", "Planification", "Budget", "Pilotage", "Agile", "Gestion des risques", "Conduite du changement", "Reporting"],
  },
  {
    triggers: ["consultant", "conseil", "transformation"],
    keywords: ["Conduite du changement", "Transformation", "Diagnostic", "Gestion de projet", "Accompagnement", "Pilotage", "Ateliers", "Recommandations"],
  },
  {
    triggers: ["directeur general", "directrice generale", "ceo ", "dg ", "general manager", "president", "gerant"],
    keywords: ["Stratégie", "P&L", "Management d'équipe", "Développement commercial", "Budget", "Gouvernance", "Transformation", "Croissance"],
  },
];

/** For a role no family covers: what any senior role is expected to show. */
const ANY_SENIOR_ROLE = ["Management d'équipe", "Pilotage", "Budget", "Gestion de projet"];

/** The keywords of a target role's family, the role itself left out. */
export function keywordsFor(targetRole: string): string[] {
  const role = normalise(targetRole);
  const family = FAMILIES.find(({ triggers }) => triggers.some((trigger) => role.includes(` ${trigger}`)));
  return family?.keywords ?? ANY_SENIOR_ROLE;
}
