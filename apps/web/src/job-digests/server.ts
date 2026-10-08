import { Pool } from "pg";
import { getApplications } from "@/applications/server";
import { mailerFromEnv } from "@/auth/mailers";
import { getAuth } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { getJobOffers } from "@/job-offers/server";
import { getProfiles } from "@/profiles/server";
import { createJobDigests, type JobDigests } from "./index";

let instance: JobDigests | undefined;

/**
 * The app's Job Digests module, on the database named by DATABASE_URL. The web
 * app opts Candidates in and out and shows the Job Digests; the worker
 * (apps/worker) makes and emails them.
 */
export function getJobDigests(): JobDigests {
  instance ??= createJobDigests(new Pool({ connectionString: process.env.DATABASE_URL }), {
    profiles: getProfiles(),
    jobOffers: getJobOffers(),
    applications: getApplications(),
    billing: getBilling(),
    mailer: mailerFromEnv(process.env),
    baseURL: String(getAuth().options.baseURL),
  });
  return instance;
}
