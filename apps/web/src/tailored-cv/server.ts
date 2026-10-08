import { Pool } from "pg";
import { getAi } from "@/ai/server";
import { getApplications } from "@/applications/server";
import { getProfiles } from "@/profiles/server";
import { createTailoredCvs, type TailoredCvs } from "./index";

let instance: TailoredCvs | undefined;

/** The app's Tailored CV module, on the database named by DATABASE_URL. */
export function getTailoredCvs(): TailoredCvs {
  instance ??= createTailoredCvs(new Pool({ connectionString: process.env.DATABASE_URL }), {
    applications: getApplications(),
    profiles: getProfiles(),
    ai: getAi(),
  });
  return instance;
}
