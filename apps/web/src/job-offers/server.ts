import { sharedPool } from "@/database/pool";
import { createJobOffers, type JobOffers } from "./index";

let instance: JobOffers | undefined;

/** The app's Job Offers module, on the database named by DATABASE_URL. */
export function getJobOffers(): JobOffers {
  instance ??= createJobOffers(sharedPool());
  return instance;
}
