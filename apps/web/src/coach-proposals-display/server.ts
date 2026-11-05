import { sharedPool } from "@/database/pool";
import { createCoachProposalsDisplays, type CoachProposalsDisplays } from "./index";

let instance: CoachProposalsDisplays | undefined;

/** The app's « Propositions du coach » setting (#717), on the database named by DATABASE_URL. */
export function getCoachProposalsDisplays(): CoachProposalsDisplays {
  instance ??= createCoachProposalsDisplays(sharedPool());
  return instance;
}
