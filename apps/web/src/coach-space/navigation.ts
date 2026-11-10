/** ADR-0099: one column of cards per page, under the Human Coach's own sidebar. */
export const COACH_SPACE_PAGES = ["aujourdhui", "candidates", "seances", "disponibilites", "profil", "revenus", "contrat", "aide"] as const;
export type CoachSpacePage = (typeof COACH_SPACE_PAGES)[number];
export const coachSpacePage = (page: CoachSpacePage) => `/espace-coach/${page}`;
