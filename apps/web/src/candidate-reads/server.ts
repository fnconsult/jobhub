import { getApplications } from "@/applications/server";
import { getFollowUps } from "@/follow-ups/server";
import { getJobDigests } from "@/job-digests/server";
import { getJobSearches } from "@/job-searches/server";
import { getProfiles } from "@/profiles/server";
import { createCandidateReads, type CandidateReads } from "./index";

let instance: CandidateReads | undefined;

/** The app's reads over HTTP (#684), on the modules the pages read, on the database named by DATABASE_URL. */
export function getCandidateReads(): CandidateReads {
  instance ??= createCandidateReads({
    applications: getApplications(),
    followUps: getFollowUps(),
    profiles: getProfiles(),
    jobSearches: getJobSearches(),
    jobDigests: getJobDigests(),
  });
  return instance;
}
