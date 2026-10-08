import { Pool } from "pg";
import { getAi } from "@/ai/server";
import { getApplications } from "@/applications/server";
import { createFrenchRegister } from "./french-register";
import { createCompanyDossiers, type CompanyDossiers } from "./index";

let instance: CompanyDossiers | undefined;

/** The app's Company Dossiers module, on the database named by DATABASE_URL and the public French register. */
export function getCompanyDossiers(): CompanyDossiers {
  instance ??= createCompanyDossiers(new Pool({ connectionString: process.env.DATABASE_URL }), {
    applications: getApplications(),
    register: createFrenchRegister(),
    ai: getAi(),
  });
  return instance;
}
