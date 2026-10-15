/**
 * The ROME codes (France Travail's job codes, e.g. "M1205") a Search Criteria
 * title names, so a France Travail search filters by job rather than by words.
 *
 *   romeCodesFor("Directrice financière (H/F)"); // ["M1205"]
 *   romeCodesFor("Chef de projet tisserand");    // []: search by keywords instead
 *
 * The table covers the jobs Jobbbox's Candidates (managers aged 40+) most often
 * look for, in French and English. Its codes are ROME job codes as published by
 * France Travail (ROME 4.0 keeps them as the "code ROME" of each job sheet).
 * UNVERIFIED against a live France Travail answer (no access yet, #119): check
 * each code against the ROME open data, or the API's reference list, once
 * access is granted, before widening the table.
 */

interface RomeJob {
  code: string;
  /** What France Travail calls the job (for the reader of this table). */
  label: string;
  /** Titles naming it, written as `normalise` leaves them: lower case, no accents, masculine, words apart. */
  titles: readonly string[];
}

const ROME_JOBS: readonly RomeJob[] = [
  {
    code: "M1205",
    label: "Direction administrative et financière",
    titles: [
      "directeur administratif et financier",
      "responsable administratif et financier",
      "directeur financier",
      "directeur des finances",
      "daf",
      "raf",
      "cfo",
      "chief financial officer",
      "finance director",
      "financial director",
      "head of finance",
    ],
  },
  {
    code: "M1204",
    label: "Contrôle de gestion",
    titles: ["controleur de gestion", "controle de gestion", "financial controller", "business controller", "fp a"],
  },
  {
    code: "M1206",
    label: "Management de groupe ou de service comptable",
    titles: ["chef comptable", "responsable comptable", "directeur comptable", "head of accounting", "chief accounting officer"],
  },
  {
    code: "M1201",
    label: "Analyse et ingénierie financière",
    titles: ["analyste financier", "financial analyst", "tresorier", "treasurer"],
  },
  {
    code: "M1202",
    label: "Audit et contrôle comptables et financiers",
    titles: ["auditeur", "audit interne", "internal auditor", "responsable audit", "directeur de l audit"],
  },
  {
    code: "M1503",
    label: "Management des ressources humaines",
    titles: [
      "directeur des ressources humaines",
      "responsable des ressources humaines",
      "responsable ressources humaines",
      "drh",
      "rrh",
      "hr director",
      "human resources director",
      "head of hr",
      "hr manager",
      "chief people officer",
    ],
  },
  {
    code: "M1301",
    label: "Direction de grande entreprise ou d'établissement public",
    titles: ["directeur general", "president directeur general", "pdg", "dg", "ceo", "chief executive officer", "managing director"],
  },
  {
    code: "M1402",
    label: "Conseil en organisation et management d'entreprise",
    titles: ["consultant en organisation", "consultant en management", "consultant transformation", "consultant en transformation", "management consultant"],
  },
  {
    code: "D1406",
    label: "Management en force de vente",
    titles: [
      "directeur commercial",
      "directeur des ventes",
      "responsable commercial",
      "sales director",
      "head of sales",
      "chief sales officer",
      "sales manager",
      "vp sales",
    ],
  },
  {
    code: "M1707",
    label: "Stratégie commerciale",
    titles: ["directeur du developpement", "business developer", "business development"],
  },
  {
    code: "M1705",
    label: "Marketing",
    titles: ["marketing", "cmo", "chief marketing officer"],
  },
  {
    code: "M1703",
    label: "Management et gestion de produit",
    titles: ["chef de produit", "product manager"],
  },
  {
    code: "M1704",
    label: "Management relation clientèle",
    titles: ["directeur relation client", "responsable relation client", "directeur service client", "customer success manager", "head of customer success"],
  },
  {
    code: "E1103",
    label: "Communication",
    titles: ["directeur de la communication", "responsable de la communication", "responsable communication", "dircom", "communication director", "head of communications"],
  },
  {
    code: "M1803",
    label: "Direction des systèmes d'information",
    titles: [
      "directeur des systemes d information",
      "directeur informatique",
      "responsable informatique",
      "dsi",
      "cio",
      "cto",
      "chief information officer",
      "chief technology officer",
      "it director",
      "head of it",
    ],
  },
  {
    code: "M1805",
    label: "Études et développement informatique",
    titles: ["developpeur", "developer", "ingenieur logiciel", "ingenieur developpement", "software engineer"],
  },
  {
    code: "M1806",
    label: "Conseil et maîtrise d'ouvrage en systèmes d'information",
    titles: ["chef de projet informatique", "chef de projet si", "consultant amoa", "product owner", "it project manager"],
  },
  {
    code: "M1101",
    label: "Achats",
    titles: ["directeur des achats", "responsable des achats", "responsable achats", "acheteur", "head of procurement", "procurement manager", "purchasing manager"],
  },
  {
    code: "N1301",
    label: "Conception et organisation de la chaîne logistique",
    titles: ["supply chain"],
  },
  {
    code: "N1302",
    label: "Direction de site logistique",
    titles: ["directeur logistique", "directeur de site logistique", "directeur d entrepot", "logistics director", "head of logistics"],
  },
  {
    code: "H2502",
    label: "Management et ingénierie de production",
    titles: ["directeur de production", "responsable de production", "directeur d usine", "directeur industriel", "plant manager", "production manager"],
  },
  {
    code: "H1502",
    label: "Management et ingénierie qualité industrielle",
    titles: ["directeur qualite", "responsable qualite", "quality manager", "head of quality"],
  },
  {
    code: "H1206",
    label: "Management et ingénierie études, recherche et développement industriel",
    titles: ["directeur r d", "responsable r d", "directeur recherche et developpement", "head of r d"],
  },
  {
    code: "H1102",
    label: "Management et ingénierie d'affaires",
    titles: ["ingenieur d affaires"],
  },
  {
    code: "K1903",
    label: "Défense et conseil juridique",
    titles: ["directeur juridique", "responsable juridique", "juriste", "general counsel", "legal director", "head of legal"],
  },
];

/** French feminine job-title endings, and their masculine form the table is written in. */
const MASCULINE: readonly [RegExp, string][] = [
  [/trice$/, "teur"],
  [/iere$/, "ier"],
  [/eure$/, "eur"],
  [/euse$/, "eur"],
  [/ale$/, "al"],
  [/ive$/, "if"],
  [/^cheffe$/, "chef"],
];

/** A title as the table is written: lower case, no accents, no (H/F) mention, masculine, words apart. */
function normalise(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b[hf]\s*\/\s*[hf]\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => MASCULINE.reduce((form, [ending, masculine]) => form.replace(ending, masculine), word))
    .join(" ");
}

/** The ROME codes of the jobs `title` names, in the order the title names them, each once; none when it names no job the table knows. */
export function romeCodesFor(title: string): string[] {
  const words = ` ${normalise(title)} `;
  return ROME_JOBS.map((job) => ({
    code: job.code,
    at: Math.min(...job.titles.map((name) => words.indexOf(` ${name} `)).filter((at) => at >= 0)),
  }))
    .filter(({ at }) => Number.isFinite(at))
    .sort((a, b) => a.at - b.at)
    .map(({ code }) => code);
}
