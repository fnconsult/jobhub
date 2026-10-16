import { sharedPool } from "@/database/pool";
import { createSearchSites, type SearchSites } from "./index";

let instance: SearchSites | undefined;

/** The app's Search sites module, on the database named by DATABASE_URL. */
export function getSearchSites(): SearchSites {
  instance ??= createSearchSites(sharedPool());
  return instance;
}
