// PROTOTYPE (throwaway). Invented data, in memory only.
export type Status = "À envoyer" | "Envoyée" | "Entretien" | "Offre" | "Refusée";
export const STATUSES: Status[] = ["À envoyer", "Envoyée", "Entretien", "Offre", "Refusée"];

export type Application = { id: string; company: string; title: string; status: Status; match: number; next?: string };

export const applications: Application[] = [
  { id: "a1", company: "Aéroline", title: "Responsable qualité fournisseurs", status: "Entretien", match: 82, next: "Entretien jeudi 6 nov. à 10:00" },
  { id: "a2", company: "Sportmax", title: "Chef de projet supply chain", status: "Envoyée", match: 74, next: "Relance prévue lundi 10 nov." },
  { id: "a3", company: "Maison Duval", title: "Responsable amélioration continue", status: "À envoyer", match: 69 },
  { id: "a4", company: "Pneus Arverne", title: "Ingénieur méthodes", status: "Refusée", match: 61 },
];

export type Offer = { id: string; title: string; company: string; city: string; match: number };
export const offers: Offer[] = [
  { id: "o1", title: "Responsable qualité site", company: "Hélice Industries", city: "Toulouse", match: 86 },
  { id: "o2", title: "Manager QHSE", company: "Valmont Agro", city: "Montauban", match: 77 },
  { id: "o3", title: "Auditeur fournisseurs senior", company: "Ciel & Rail", city: "Blagnac", match: 71 },
];

export const freeConversations = [
  { id: "c1", title: "Préparer mon pitch en 2 minutes" },
  { id: "c2", title: "Négocier le salaire" },
  { id: "c3", title: "Reconversion à 55 ans" },
];

export const agenda = {
  toSchedule: [{ id: "g0", title: "Séance avec Claire M. (coach)", detail: "Payée · à réserver sur son agenda" }],
  days: [
    { day: "Jeudi 6 novembre", items: [{ id: "g1", time: "10:00", title: "Entretien · Aéroline", detail: "Visio · 45 min" }] },
    { day: "Mardi 11 novembre", items: [{ id: "g2", time: "14:30", title: "Coaching · Claire M.", detail: "Visio · 60 min · modifié par le coach" }] },
  ],
};

export const humanCoaches = [
  { id: "h1", name: "Claire M.", focus: "Industrie, cadres seniors" },
  { id: "h2", name: "Jérôme T.", focus: "Reconversion, entretiens" },
];

export const replies: Record<string, string> = {
  default:
    "Bonne question. Voici comment je m'y prendrais :\n\n1. Partir de votre candidature la plus avancée, Aéroline, où l'entretien a lieu jeudi.\n2. Relire l'offre et noter les trois attentes qui reviennent le plus.\n3. Préparer pour chacune un exemple concret de votre parcours, en deux ou trois phrases.\n\nVoulez-vous que je vous propose ces trois exemples à partir de votre CV ?",
  application:
    "Pour l'entretien chez Aéroline jeudi, je vous propose de travailler trois points : votre expérience d'audit fournisseurs, la réduction des non-conformités que vous avez menée en 2019, et votre façon d'embarquer une équipe. Je peux vous poser les questions comme le ferait le recruteur, une par une. On commence ?",
};
