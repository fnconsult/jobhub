import { getExternalApiLog } from "@/ai-usage/server";
import { sharedPool } from "@/database/pool";
import { createReferenceData, type IndustryReference, type ReferenceData } from "./index";

let instance: ReferenceData | undefined;

/** The app's reference data (#236): the Sectors', Subsectors' and Domains' labels, each call to their sources recorded. */
export function getReferenceData(): ReferenceData {
  instance ??= createReferenceData(sharedPool(), { externalApis: getExternalApiLog() });
  return instance;
}

/** The labels, or none without a database (a page still renders, naming no Sector). */
export async function readIndustryReference(): Promise<IndustryReference> {
  if (!process.env.DATABASE_URL) return { sectors: [], subsectors: [], domains: [] };
  return getReferenceData().read();
}
