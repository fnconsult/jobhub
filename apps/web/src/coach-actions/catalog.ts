/**
 * The Coach Actions shipped (ADR-0077): none yet. Each group arrives with its own ticket (Candidatures, Agenda, Profil,
 * Recherches d'offres et Job Digests, Documents), each Coach Action built on the domain module its page's route calls,
 * with its Eval Cases. Until one is here, the AI Coach is offered no tool, even with COACH_ACTIONS_ENABLED on.
 */
import { coachActionCatalog, type CoachAction } from "./index";

export const COACH_ACTIONS: readonly CoachAction[] = coachActionCatalog([]);
