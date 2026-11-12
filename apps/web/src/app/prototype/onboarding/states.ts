/** THROWAWAY prototype (#995): the states `?etat=` shows. */
export const STATES = ["construction", "resume", "modification", "recherche", "offres"] as const;
export type State = (typeof STATES)[number];
