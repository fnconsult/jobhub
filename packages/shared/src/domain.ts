/**
 * Domain types shared by the web app, the extension and the worker.
 * Vocabulary: CONTEXT.md at the repo root.
 */

/** The stage an Application is at. Changed manually by the Candidate. */
export const APPLICATION_STATUSES = [
  "to_apply", // À postuler
  "applied", // Postulée
  "followed_up", // Relancée
  "interview", // Entretien
  "offer_received", // Offre reçue
  "accepted", // Acceptée
  "rejected", // Refusée (end state)
  "abandoned", // Abandonnée (end state)
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** The subscription tier a Candidate is on. */
export const PLANS = ["free", "standard", "premium"] as const;
export type Plan = (typeof PLANS)[number];
