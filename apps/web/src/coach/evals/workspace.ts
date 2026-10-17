/**
 * An eval case's fictional Candidate as the AI Coach reads them: one Profile, and what is In view.
 * Built in memory, so the Coach under test runs exactly as in the app (context, Playbook table,
 * persona) without a database.
 */
import { scoreMatch, type JobOffer } from "@jobhub/shared";
import type { Application } from "../../applications";
import type { Profile } from "../../profiles";
import type { CoachDeps, CoachFocus } from "../index";
import type { CoachEvalCase } from "./cases";

export const EVAL_CANDIDATE_ID = "eval-candidate";

const PROFILE_ID = "e0000000-0000-4000-8000-000000000001";
const JOB_OFFER_ID = "e0000000-0000-4000-8000-000000000002";
const APPLICATION_ID = "e0000000-0000-4000-8000-000000000003";

/** The Coach's sources for the case, and what the Candidate has In view. */
export function evalWorkspace(evalCase: CoachEvalCase): { sources: Omit<CoachDeps, "ai" | "knowledge">; focus?: CoachFocus } {
  const { candidate, inView } = evalCase;
  const profile: Profile = {
    id: PROFILE_ID,
    name: candidate.targetRole,
    archived: false,
    // No location: the Coach context leaves it out.
    searchCriteria: { targetRole: candidate.targetRole, location: candidate.location ?? "" },
    masterCv: {
      version: 1,
      content: {
        // A fictional surname: the Coach context keeps the first name only.
        fullName: `${candidate.firstName} Exemple`,
        headline: candidate.targetRole,
        email: "",
        phone: "",
        location: candidate.location ?? "",
        summary: candidate.summary ?? "",
        experience: candidate.experience.map((item) => ({ title: item.title, employer: item.employer, location: "", period: item.period, description: item.description ?? "" })),
        education: [],
        skills: candidate.skills,
        languages: [],
      },
    },
  };
  const jobOffer: JobOffer | null =
    inView && inView.kind !== "profile" ? { id: JOB_OFFER_ID, contractType: "cdi", source: { url: "https://exemple.fr/offre" }, ...inView.jobOffer } : null;
  const application: Application | null =
    jobOffer && inView?.kind === "application"
      ? {
          id: APPLICATION_ID,
          status: inView.status,
          statusChangedAt: new Date("2026-10-01T09:00:00Z"),
          createdAt: new Date("2026-09-20T09:00:00Z"),
          jobOffer,
          profile: { id: profile.id, name: profile.name },
          interviews: [],
          matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer, today: new Date("2026-10-15") }),
        }
      : null;

  const mine = <T>(candidateId: string, item: T | null) => (candidateId === EVAL_CANDIDATE_ID && item ? [item] : []);
  const sources: Omit<CoachDeps, "ai" | "knowledge"> = {
    profiles: {
      get: async (candidateId, id) => mine(candidateId, profile).find((p) => p.id === id) ?? null,
      list: async (candidateId) => mine(candidateId, profile).map(({ id, name, archived }) => ({ id, name, archived })),
    },
    applications: {
      get: async (candidateId, id) => mine(candidateId, application).find((a) => a.id === id) ?? null,
      list: async (candidateId) =>
        mine(candidateId, application).map(({ id, status, statusChangedAt, jobOffer, profile, interviews }) => ({ id, status, statusChangedAt, jobOffer, profile, interviews })),
    },
    jobOffers: { get: async (id) => (jobOffer?.id === id ? jobOffer : null) },
    jobSearches: { get: async () => null, latest: async () => null },
    jobDigests: { get: async () => null, latest: async () => null },
  };

  const focus: CoachFocus | undefined =
    inView?.kind === "profile"
      ? { kind: "profile", id: PROFILE_ID }
      : inView?.kind === "job_offer"
        ? { kind: "job_offer", id: JOB_OFFER_ID }
        : inView?.kind === "application"
          ? { kind: "application", id: APPLICATION_ID }
          : undefined;
  return { sources, ...(focus ? { focus } : {}) };
}
