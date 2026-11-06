import { sharedPool } from "@/database/pool";
import { createConsumption, type Consumption } from "./index";

let instance: Consumption | undefined;

/** The app's Consumption read model (#799), on the database named by DATABASE_URL: what « Votre consommation » reads (#801). */
export function getConsumption(): Consumption {
  instance ??= createConsumption(sharedPool());
  return instance;
}
