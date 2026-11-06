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
   * last line, so the flow sees « Arrêter » while it comes.
   */
  coach: { message: "E2E_COACH_LONG Comment préparer mon entretien ?", replyEnd: "FIN DE LA RÉPONSE" },
  /** A Free conversation, titled by its first message as the platform titles it; the key screen « conversation ». */
  conversation: { title: "Préparer mon entretien chez Aéroline" },
  /**
   * The fixed day of every seeded date the key screens show, so their captures do not change from one day to the next:
   * more than 30 days ago (MAX_POSTING_AGE_DAYS), so the Offer box never says its Job Offers « sort dans n j ».
   */
  day: "2026-10-01T09:00:00Z",
} as const;

/** The key screens, captured in this order on each run (`captures/<device>/<theme>/<screen>.png`). */
export const KEY_SCREENS = ["accueil", "candidatures", "fiche", "recherches", "agenda", "conversation"] as const;

/**
 * What the run gives the flows besides the device's (devices.ts): the stack's helper (its sign-in codes), the run's
 * Candidate, and what to do with the captures: `compare` (CI), `record` (redrawing them) or `off`.
 */
export const STACK_ENV = ["STACK_URL", "STACK_EMAIL", "CAPTURES"] as const;
