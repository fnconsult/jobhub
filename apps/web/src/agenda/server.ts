import { sharedPool } from "@/database/pool";
import { createAgenda, type Agenda } from "./index";

let instance: Agenda | undefined;

/** The app's Agenda, on the database named by DATABASE_URL. */
export function getAgenda(): Agenda {
  instance ??= createAgenda(sharedPool());
  return instance;
}
