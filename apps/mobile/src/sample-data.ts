/**
 * Sample data, until the app reads the API (ADR-0076: the GETs added to `/api/*`): one Application and two Free
 * conversations, enough to reach every kind of page.
 */
export const SAMPLE_APPLICATIONS = [{ id: "a1", title: "Aéroline · Responsable qualité" }] as const;
export const SAMPLE_FREE_CONVERSATIONS = [
  { id: "c1", title: "Me présenter en deux minutes" },
  { id: "c2", title: "Préparer la négociation du salaire" },
] as const;
