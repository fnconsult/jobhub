import { Pool } from "pg";
import { getAi } from "@/ai/server";
import { getApplications } from "@/applications/server";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { getProfiles } from "@/profiles/server";
import { createTailoredDocuments, type TailoredDocuments } from "./index";

let instance: TailoredDocuments | undefined;

/**
 * The app's Tailored Documents module, on the database named by DATABASE_URL.
 * Drafts draw on the Application's Company Dossier (#17) and its Suggested
 * Contact Roles once one is built, and on the Master CV and the Job Offer alone until then.
 */
export function getTailoredDocuments(): TailoredDocuments {
  instance ??= createTailoredDocuments(new Pool({ connectionString: process.env.DATABASE_URL }), {
    applications: getApplications(),
    profiles: getProfiles(),
    ai: getAi(),
    companyDossiers: getCompanyDossiers(),
  });
  return instance;
}
