import { Pool } from "pg";
import { getAi } from "@/ai/server";
import { getApplications } from "@/applications/server";
import { getProfiles } from "@/profiles/server";
import { createTailoredDocuments, type TailoredDocuments } from "./index";

let instance: TailoredDocuments | undefined;

/**
 * The app's Tailored Documents module, on the database named by DATABASE_URL.
 * Company Dossiers (#17) are not wired in yet: until they are, drafts are written
 * from the Master CV and the Job Offer alone. Pass `companyDossiers` once they exist.
 */
export function getTailoredDocuments(): TailoredDocuments {
  instance ??= createTailoredDocuments(new Pool({ connectionString: process.env.DATABASE_URL }), {
    applications: getApplications(),
    profiles: getProfiles(),
    ai: getAi(),
  });
  return instance;
}
