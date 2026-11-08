/**
 * What the seeded test stack gives the Maestro flows (#705): one fresh Candidate per run, signed in by the code of their
 * sign-in email, with the data below (e2e/mobile-stack.spec.ts creates it through the platform's own API). Every name
 * and employer is invented. The flows look for these texts as they look for the app's own labels (flows.test.ts).
 */
export const MAESTRO_SEED = {
  profile: { targetRole: "Responsable qualité", location: "Lyon" },
  /** « Postulée »: the Application flow sets it to « Entretien » and adds an Interview. */
  applied: { title: "Responsable qualité", employer: "Aéroline Démo", row: "Responsable qualité · Aéroline Démo", ficheEmployer: "Aéroline Démo · Lyon" },
  /** « Entretien », with an Interview on a fixed day, the one the Agenda shows. */
  interview: {
    title: "Contrôleuse de gestion",
    employer: "Transports Ravel Démo",
    row: "Contrôleuse de gestion · Transports Ravel Démo",
    scheduledAt: "2031-03-12T14:30",
    durationMinutes: 45,
    note: "Avec la DRH",
  },
  /** The Interview the Application flow adds, as the person types it. */
  addedInterview: { date: "26/11/2031", time: "10:00", note: "Second tour" },
  /**
   * Two Job Offers of one employer found by a done Job Search of the Profile, on a fixed day: in the Offer box, à traiter,
   * in this order, which Recherches d'offres opens on (ADR-0090). The flow « Recherches d'offres » follows the first.
   */
  jobOffers: ["Cheffe de projet qualité", "Auditrice qualité fournisseurs"],
  jobOffersEmployer: "Industries Démo",
  /** Their rows in the Offer box, « title · employer ». */
  jobOfferRows: ["Cheffe de projet qualité · Industries Démo", "Auditrice qualité fournisseurs · Industries Démo"],
  /**
   * The conversation flow's message: e2e/support/fake-mistral.mjs streams a long reply to it, thirty paragraphs, then its
   * last line, 15 s after it is sent (E2E_COACH_SLOW), so the flow sees « Arrêter » while it comes: Maestro's tap on
   * « Envoyer » waits for the screen to settle, and a reply streamed at once was over by then.
   */
  coach: { message: "E2E_COACH_LONG E2E_COACH_SLOW=15000 Comment préparer mon entretien ?", replyEnd: "FIN DE LA RÉPONSE" },
  /** A Free conversation, titled by its first message as the platform titles it; the key screen « conversation ». */
  conversation: { title: "Préparer mon entretien chez Aéroline" },
  /**
   * The fixed day of every seeded date the key screens show, so their captures do not change from one day to the next,
   * but the Offer box's Arrivals (`offerBoxArrivalAt`).
   */
  day: "2026-10-01T09:00:00Z",
} as const;

/**
 * Its Job Offers' Arrival in the Offer box: 10 days before the run, at 09:00 UTC. A fixed day would have them « Expirées
 * sans décision » once 30 days old (MAX_POSTING_AGE_DAYS, #817), « Suivre » hidden; 10 days keeps them à traiter and out
 * of the last 7 days that say « sort dans n j ». Only their « arrivée le … » chip changes from one day to the next.
 */
export const OFFER_BOX_ARRIVAL_DAYS_AGO = 10;
export function offerBoxArrivalAt(now: Date = new Date()): string {
  const at = new Date(now);
  at.setUTCDate(at.getUTCDate() - OFFER_BOX_ARRIVAL_DAYS_AGO);
  at.setUTCHours(9, 0, 0, 0);
  return at.toISOString();
}

/** The key screens, captured in this order on each run (`captures/<device>/<theme>/<screen>.png`). */
export const KEY_SCREENS = ["accueil", "candidatures", "fiche", "recherches", "agenda", "conversation"] as const;

/**
 * What the run gives the flows besides the device's (devices.ts): the stack's helper (its sign-in codes), the run's
 * Candidate, and what to do with the captures: `compare` (CI), `record` (redrawing them) or `off`.
 */
export const STACK_ENV = ["STACK_URL", "STACK_EMAIL", "CAPTURES"] as const;
