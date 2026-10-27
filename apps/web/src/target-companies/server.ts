import { getExternalApiLog } from "@/ai-usage/server";
import { getApplications } from "@/applications/server";
import { createFrenchRegister } from "@/company-dossiers/french-register";
import { sharedPool } from "@/database/pool";
import { getJobOffers } from "@/job-offers/server";
import { createTargetCompanies, type TargetCompanies } from "./index";

let instance: TargetCompanies | undefined;

/**
 * The app's Target Companies module, on the database named by DATABASE_URL: a company the Candidate adds is resolved
 * in the public French register, and their Spontaneous Applications are Applications like any other.
 */
export function getTargetCompanies(): TargetCompanies {
  instance ??= createTargetCompanies(sharedPool(), {
    register: createFrenchRegister({ externalApis: getExternalApiLog() }),
    jobOffers: getJobOffers(),
    applications: getApplications(),
  });
  return instance;
}
