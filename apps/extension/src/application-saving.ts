/**
 * Saving the Job Offer captured in the extension as an Application of the
 * signed-in Candidate (ADR-0011: the extension uses the web app's session).
 *
 * One deep module. The analysis page calls `open()` once a Candidate is signed
 * in, then `save(choice)` with the Profile they chose. Behind it:
 *  - on sign-up (the Candidate has no Profile yet), the Guest's work is kept at
 *    once: their CV becomes their first Profile, the captured Job Offer their
 *    first Application ("À postuler");
 *  - otherwise the Candidate chooses the Profile: one of theirs or, when a CV is
 *    in the session, a new one made from it;
 *  - once saved, the CV and the Job Offer leave the session: they are in the
 *    Candidate's account now, and a Guest's CV must not outlive its use
 *    (ADR-0003). Only where they went is kept, so every page shows it. Until
 *    then (a refusal, the web app out of reach) they are kept, to try again;
 *  - the extension's pages share the session, so they save one at a time
 *    (`lock`): several pages open at sign-up still make one Profile.
 * Problems come back as results, never exceptions.
 */
import { fitProfileName, type JobOffer } from "@jobhub/shared";
import type { GuestSession, GuestSessionContent } from "./guest-session";
import type { JobbboxApi, ProfileOption, UpgradePrompt } from "./jobbbox-api";

export type ProfileChoice = { profileId: string } | "new_profile_from_cv";

export type SavingState =
  /** No captured Job Offer to save. */
  | { state: "nothing_to_save" }
  /** The Candidate chooses the Profile; `fromCv`: the CV in the session can become a new one. */
  | { state: "choose"; profiles: ProfileOption[]; fromCv: boolean }
  /** Saved as an Application; `newProfile`: the Profile made from the CV for it, if one was. */
  | { state: "saved"; applicationId: string; jobOffer: JobOffer; newProfile: ProfileOption | null };

export type SavingFailure =
  /** Their Plan allows no more Profiles: the Upgrade Prompt, if a Plan allows more. */
  | { state: "failed"; error: "plan_quota_reached"; prompt: UpgradePrompt | null }
  /**
   * Neither the CV nor the Job Offer gives a target role and a location for the
   * Profile ("search_criteria_missing"), the Job Offer is gone ("job_offer_gone"),
   * nobody is signed in any more ("signed_out"), or the web app cannot be reached.
   */
  | { state: "failed"; error: "search_criteria_missing" | "job_offer_gone" | "signed_out" | "unreachable" };

export interface ApplicationSaving {
  /** What there is to do for the signed-in Candidate; on sign-up, keeps the Guest's work at once. */
  open(): Promise<SavingState | SavingFailure>;
  /** Saves the captured Job Offer as an Application with the chosen Profile. */
  save(choice: ProfileChoice): Promise<SavingState | SavingFailure>;
}

type Api = Pick<JobbboxApi, "profiles" | "createProfile" | "saveApplication">;

/** Runs `work` while no other page of the extension saves. */
export type Lock = <T>(work: () => Promise<T>) => Promise<T>;

/** The browser's Web Locks, shared by every page of the extension (one origin). */
const webLock: Lock = (work) => navigator.locks.request("jobbbox-application-saving", work);

const failed = (error: Exclude<SavingFailure["error"], "plan_quota_reached">): SavingFailure => ({ state: "failed", error });

export function createApplicationSaving({ api, session, lock = webLock }: { api: Api; session: GuestSession; lock?: Lock }): ApplicationSaving {
  async function save(choice: ProfileChoice, work: GuestSessionContent): Promise<SavingState | SavingFailure> {
    const { jobOffer, cv, searchCriteria } = work;
    if (!jobOffer) return { state: "nothing_to_save" };

    let profileId: string;
    let newProfile: ProfileOption | null = null;
    if (choice === "new_profile_from_cv") {
      if (!cv) return failed("search_criteria_missing");
      const criteria = {
        targetRole: fitProfileName(searchCriteria?.targetRole || jobOffer.title),
        location: (searchCriteria?.location || jobOffer.location || "").trim(),
      };
      if (!criteria.targetRole || !criteria.location) return failed("search_criteria_missing");
      const created = await api.createProfile(cv, criteria);
      if (!created.ok) {
        if (created.error === "plan_quota_reached") return { state: "failed", error: created.error, prompt: created.prompt };
        return failed(created.error === "invalid" ? "search_criteria_missing" : created.error === "signed_out" ? "signed_out" : "unreachable");
      }
      profileId = created.profileId;
      newProfile = { id: profileId, name: criteria.targetRole };
    } else {
      profileId = choice.profileId;
    }

    const saved = await api.saveApplication(jobOffer.id, profileId);
    if (!saved.ok) return failed(saved.error === "not_found" ? "job_offer_gone" : saved.error === "signed_out" ? "signed_out" : "unreachable");
    const kept = { applicationId: saved.applicationId, jobOffer, newProfile };
    await session.keepSaved(kept);
    return { state: "saved", ...kept };
  }

  return {
    open: () =>
      lock(async () => {
        const work = await session.read();
        if (!work.jobOffer) return work.saved ? { state: "saved", ...work.saved } : { state: "nothing_to_save" };
        const listed = await api.profiles();
        if (!listed.ok) return failed(listed.error);
        if (listed.profiles.length === 0 && work.cv) return save("new_profile_from_cv", work);
        return { state: "choose", profiles: listed.profiles, fromCv: Boolean(work.cv) };
      }),
    save: (choice) =>
      lock(async () => {
        const work = await session.read();
        // Another page saved it meanwhile.
        if (!work.jobOffer && work.saved) return { state: "saved", ...work.saved };
        return save(choice, work);
      }),
  };
}
