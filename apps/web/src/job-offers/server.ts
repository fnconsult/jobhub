import { Pool } from "pg";
import { createJobOffers, type JobOffers } from "./index";

let instance: JobOffers | undefined;

/** The app's Job Offers module, on the database named by DATABASE_URL. */
export function getJobOffers(): JobOffers {
  instance ??= createJobOffers(new Pool({ connectionString: process.env.DATABASE_URL }));
  return instance;
}
