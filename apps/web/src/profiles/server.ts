import { Pool } from "pg";
import { createProfiles, type Profiles } from "./index";

let instance: Profiles | undefined;

/** The app's Profiles module, on the database named by DATABASE_URL. */
export function getProfiles(): Profiles {
  instance ??= createProfiles(new Pool({ connectionString: process.env.DATABASE_URL }));
  return instance;
}
