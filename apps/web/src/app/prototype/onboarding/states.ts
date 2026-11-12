/** THROWAWAY prototype (#995): the states `?etat=` shows (collecte: the search runs alongside the questions, #994). */
export const STATES = ["construction", "collecte", "resume", "modification", "recherche", "offres"] as const;
export type State = (typeof STATES)[number];
