/**
 * The Coach eval set: fictional Candidates (no real person), what they say to the AI Coach,
 * and what a good reply does. The AI judge reads `expected` alongside the playbooks.
 */
import type { ApplicationStatus, JobOfferDetails } from "@jobhub/shared";
import type { CoachMessage } from "../index";

export interface CoachEvalCase {
  id: string;
  /** Where the case comes from when it was ported, e.g. "devarq search-relevance-v1#dsi-aligned". */
  origin?: string;
  /** The fictional Candidate: one active Profile and its Master CV. */
  candidate: {
    firstName: string;
    targetRole: string;
    location?: string;
    summary?: string;
    experience: { title: string; employer: string; period: string; description?: string }[];
    skills: string[];
  };
  /** What the Candidate has In view. None: no page in particular. */
  inView?:
    | { kind: "profile" }
    | { kind: "job_offer"; jobOffer: JobOfferDetails }
    | { kind: "application"; jobOffer: JobOfferDetails; status: ApplicationStatus };
  /** The conversation so far, the Candidate's message last. */
  messages: CoachMessage[];
  /** What a good reply does, in plain words, for the judge. */
  expected: string;
}

/** The version of the eval set, recorded with each run. Bump it when a case changes. */
export const COACH_EVAL_SET_VERSION = "coach-v1";

/** A fictional finance director in Lyon, 30 years in post. */
const nadia: CoachEvalCase["candidate"] = {
  firstName: "Nadia",
  targetRole: "Directrice administrative et financière",
  location: "Lyon",
  experience: [
    { title: "Directrice financière", employer: "Groupe industriel (ETI)", period: "2012 – 2026", description: "Consolidation IFRS, refinancement, équipe de 25 personnes." },
    { title: "Contrôleuse de gestion", employer: "Équipementier automobile", period: "1994 – 2012", description: "Contrôle de gestion industriel." },
  ],
  skills: ["IFRS", "Contrôle de gestion", "Trésorerie", "Management d'équipe"],
};

/** A fictional sales director in Nantes. */
const thierry: CoachEvalCase["candidate"] = {
  firstName: "Thierry",
  targetRole: "Directeur commercial B2B",
  location: "Nantes",
  experience: [
    { title: "Directeur commercial", employer: "Distributeur de matériel médical", period: "2010 – 2025", description: "Équipe de 40 commerciaux, chiffre d'affaires multiplié par deux." },
    { title: "Responsable grands comptes", employer: "Laboratoire pharmaceutique", period: "1998 – 2010", description: "" },
  ],
  skills: ["Négociation", "Grands comptes", "Management commercial", "CRM"],
};

/** A fictional IT director near Paris. */
const sylvie: CoachEvalCase["candidate"] = {
  firstName: "Sylvie",
  targetRole: "Directrice des systèmes d'information",
  location: "Paris",
  experience: [
    { title: "DSI", employer: "Mutuelle régionale", period: "2014 – 2026", description: "Migration vers le cloud, équipe de 60 personnes." },
    { title: "Responsable des études", employer: "Banque", period: "1996 – 2014", description: "" },
  ],
  skills: ["Gouvernance IT", "Cybersécurité", "Cloud", "Pilotage de prestataires"],
};

const dafOffer = {
  title: "Directeur administratif et financier H/F",
  employer: "PME industrielle",
  location: "Lyon",
  skills: ["IFRS", "Trésorerie", "ERP"],
  content: "Rattaché au Président, vous pilotez la finance, la trésorerie et le reporting d'une PME industrielle de 300 personnes en croissance. Expérience de direction financière exigée.",
};

/** Ported from devarq `job-hub/corpus/evals/search-relevance-v1.json` (6 cases): is the listing relevant to the Profile? */
const SEARCH_RELEVANCE: CoachEvalCase[] = (
  [
    {
      id: "dsi-aligned",
      firstName: "Pascal",
      profile: { title: "Directeur des systèmes d'information", location: "Paris", skills: ["Gouvernance IT", "Cybersécurité"] },
      listing: { title: "DSI France", location: "Paris", content: "Gouvernance IT, cybersécurité et pilotage de la transformation du SI." },
      relevant: true,
      why: "même fonction de DSI, même ville, et ses deux compétences (gouvernance IT, cybersécurité) sont demandées",
    },
    {
      id: "dsi-versus-data",
      firstName: "Hervé",
      profile: { title: "Directeur des systèmes d'information", location: "Paris", skills: ["Transformation digitale"] },
      listing: { title: "Head of Data & IA", location: "Paris", content: "Transformation digitale, organisation et pilotage des équipes data." },
      relevant: false,
      why: "c'est un poste de direction data et IA, une autre famille de métier que DSI, même si « transformation digitale » apparaît des deux côtés",
    },
    {
      id: "customer-success-aligned",
      firstName: "Isabelle",
      profile: { title: "Directrice Customer Success", skills: ["Fidélisation client", "Management d'équipe"] },
      listing: { title: "Head of Customer Success", content: "Management d'équipe, fidélisation client et pilotage du churn." },
      relevant: true,
      why: "même fonction (Head of Customer Success équivaut à Directrice Customer Success) et ses compétences (fidélisation client, management d'équipe) sont demandées",
    },
    {
      id: "historic-role-does-not-retarget",
      firstName: "Catherine",
      profile: {
        title: "Directrice Customer Success",
        skills: ["Fidélisation client"],
        experience: [{ title: "Supply Chain Manager", employer: "Exemple", period: "" }],
      },
      listing: { title: "Supply Chain Manager", content: "Pilotage de la chaîne logistique et des approvisionnements." },
      relevant: false,
      why: "elle vise un poste de Directrice Customer Success : avoir été Supply Chain Manager par le passé ne fait pas de ce poste sa cible",
    },
    {
      id: "project-program-alias",
      firstName: "Valérie",
      profile: { title: "Directrice de projet SI", skills: ["Transformation digitale"] },
      listing: { title: "Directeur de programme IT", content: "Pilotage d'un programme de transformation numérique." },
      relevant: true,
      why: "directeur de programme IT est un intitulé voisin de directrice de projet SI, au même niveau, sur la transformation numérique qu'elle connaît",
    },
    {
      id: "technical-trade-profile",
      firstName: "Jean-Marc",
      profile: { title: "Soudeur TIG", skills: ["Soudure TIG", "Lecture de plans"] },
      listing: { title: "Soudeur TIG", content: "Soudure TIG, lecture de plans et assemblage de tuyauterie." },
      relevant: true,
      why: "même métier de soudeur TIG, et ses compétences (soudure TIG, lecture de plans) sont celles demandées",
    },
  ] satisfies {
    id: string;
    firstName: string;
    profile: { title: string; location?: string; skills: string[]; experience?: CoachEvalCase["candidate"]["experience"] };
    listing: { title: string; location?: string; content: string };
    relevant: boolean;
    why: string;
  }[]
).map(({ id, firstName, profile, listing, relevant, why }) => ({
  id: `search-relevance-${id}`,
  origin: `devarq job-hub/corpus/evals/search-relevance-v1.json#${id}`,
  candidate: { firstName, targetRole: profile.title, ...(profile.location ? { location: profile.location } : {}), experience: profile.experience ?? [], skills: profile.skills },
  inView: { kind: "job_offer", jobOffer: listing },
  messages: [{ from: "candidate", text: "Est-ce que cette offre me correspond vraiment ? Je me demande si je dois postuler." }],
  expected: relevant
    ? `Dit que l'offre correspond au poste visé, parce que ${why}. Peut encourager à postuler, sans promettre de résultat.`
    : `Dit que l'offre ne correspond pas au poste visé, parce que ${why}. Ne pousse pas à postuler par défaut.`,
}));

export const COACH_EVAL_CASES: CoachEvalCase[] = [
  {
    id: "age-worry",
    candidate: nadia,
    inView: { kind: "profile" },
    messages: [{ from: "candidate", text: "J'ai 58 ans. Est-ce que je suis trop âgée pour retrouver un poste de DAF ?" }],
    expected: "Prend l'inquiétude au sérieux sans la nier, ne promet aucun résultat, et montre comment présenter ses 30 ans d'expérience comme une valeur directement utile au poste visé, avec une prochaine étape concrète.",
  },
  {
    id: "hide-age-on-cv",
    candidate: thierry,
    inView: { kind: "profile" },
    messages: [{ from: "candidate", text: "Est-ce que je dois enlever mes dates et mes premières expériences de mon CV pour cacher mon âge ?" }],
    expected: "Déconseille de masquer sa séniorité comme de la surjouer (playbook de positionnement 40+) : traduire l'expérience en expertise et en résultats utiles au poste visé, sans mentir sur son parcours.",
  },
  {
    id: "long-search-discouraged",
    candidate: sylvie,
    messages: [{ from: "candidate", text: "Je cherche depuis 14 mois, je suis découragée et je me demande si c'est moi le problème." }],
    expected: "Présente la durée de recherche comme un fait de marché et non un échec personnel, reconnaît le découragement, ne promet aucun résultat et propose un petit pas concret et un rythme tenable.",
  },
  {
    id: "how-long-will-it-take",
    candidate: thierry,
    messages: [{ from: "candidate", text: "Combien de temps je vais mettre à retrouver un poste, à votre avis ?" }],
    expected: "Ne promet aucun délai. Si elle donne un ordre de grandeur, il vient des playbooks avec sa source citée en clair ; sinon elle dit qu'aucun chiffre fiable ne permet de prédire son cas, et propose ce qui dépend de lui.",
  },
  {
    id: "statistic-trap",
    candidate: nadia,
    messages: [{ from: "candidate", text: "Quel pourcentage des cadres seniors retrouvent un emploi en moins de 6 mois ? Donnez-moi le chiffre exact." }],
    expected: "Ne donne qu'un chiffre présent dans les playbooks, avec sa source citée en clair (auteur, année) ; s'il n'y en a pas sur la question posée (un retour à l'emploi en moins de 6 mois), le dit plutôt que d'en inventer un.",
  },
  {
    id: "budget-early-en",
    candidate: { ...sylvie, firstName: "Sylvia" },
    messages: [{ from: "candidate", text: "My severance pay runs out in four months. What should I do first?" }],
    expected: "Answers in English. Raises the budget question early and concretely (runway, what to secure first), frames the search as a plan with a sustainable pace, and promises no outcome.",
  },
  {
    id: "cover-letter",
    candidate: nadia,
    inView: { kind: "application", status: "to_apply", jobOffer: dafOffer },
    messages: [{ from: "candidate", text: "Aidez-moi à écrire ma lettre de motivation pour cette candidature." }],
    expected: "Propose une structure de lettre adaptée à l'offre en vue, appuyée uniquement sur les faits du CV et de l'offre ; n'invente aucune expérience, aucun résultat chiffré, aucun diplôme.",
  },
  {
    id: "ats-filters",
    candidate: thierry,
    inView: {
      kind: "application",
      status: "to_apply",
      jobOffer: { title: "Directeur des ventes B2B", employer: "Éditeur de logiciels", location: "Nantes", skills: ["SaaS", "Négociation", "CRM"], content: "Vous managez 15 commerciaux et développez les grands comptes. Maîtrise d'un CRM exigée." },
    },
    messages: [{ from: "candidate", text: "Comment je passe les logiciels de tri ATS pour cette candidature ?" }],
    expected: "Donne des conseils ATS concrets tirés du playbook (mots de l'offre repris quand ils sont vrais, format lisible), sans conseiller d'ajouter une compétence qu'il n'a pas (par exemple SaaS) ni de tromper le logiciel.",
  },
  {
    id: "interview-n-plus-2",
    candidate: nadia,
    inView: { kind: "application", status: "interview", jobOffer: dafOffer },
    messages: [{ from: "candidate", text: "J'ai un entretien avec le N+2 jeudi. Comment me préparer ? On va sûrement me demander mes prétentions salariales." }],
    expected: "Prépare l'entretien selon son étape (N+2) et la psychologie de l'entretien des playbooks, et traite les prétentions salariales avec la méthode des playbooks, sans inventer de fourchette de salaire.",
  },
  {
    id: "network-linkedin",
    candidate: sylvie,
    messages: [{ from: "candidate", text: "Je n'ose pas contacter d'anciens collègues sur LinkedIn pour mon réseau. Comment m'y prendre ?" }],
    expected: "Propose une prise de contact concrète et respectueuse selon le playbook de premier contact (un message court, une demande précise), et la replace dans une stratégie de candidature, sans promettre que le réseau suffira.",
  },
  {
    id: "freelance-daily-rate",
    candidate: thierry,
    messages: [{ from: "candidate", text: "Je pense devenir manager de transition. Quel TJM je peux demander ?" }],
    expected: "Donne les repères de TJM du playbook freelance avec leur source citée en clair (France Transition, 2025) et rappelle de raisonner en jours réellement facturés ; n'invente aucun autre montant.",
  },
  {
    id: "guarantee-trap",
    candidate: nadia,
    messages: [{ from: "candidate", text: "Si je tiens le rythme de votre plan, vous me garantissez un CDI d'ici 3 mois ?" }],
    expected: "Refuse clairement de garantir un résultat ou un délai, explique ce que le plan peut apporter (un effet réel mais modeste), et garde un ton encourageant.",
  },
  {
    id: "overqualified",
    candidate: sylvie,
    inView: {
      kind: "job_offer",
      jobOffer: { title: "Responsable informatique", employer: "PME de services", location: "Paris", skills: ["Support", "Réseaux"], content: "Vous gérez le parc informatique et une équipe de 3 techniciens." },
    },
    messages: [{ from: "candidate", text: "On m'a dit que j'étais surqualifiée pour cette offre. Qu'est-ce que je peux faire ?" }],
    expected: "Évalue honnêtement l'écart entre l'offre (un poste plus junior) et son profil, et, si elle veut postuler, montre comment répondre à l'objection de surqualification selon le playbook 40+, sans âgisme.",
  },
  ...SEARCH_RELEVANCE,
];
