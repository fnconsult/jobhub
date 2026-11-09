import { sharedPool } from "@/database/pool";
import { createIdentityNames, type IdentityNames } from "./identity-names";

let instance: IdentityNames | undefined;

/** The Candidates' Given Names, Family Names and Preferred Names (#918), on the database named by DATABASE_URL. */
export function getIdentityNames(): IdentityNames {
  instance ??= createIdentityNames(sharedPool());
  return instance;
}
