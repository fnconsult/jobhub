import { Pool } from "pg";
import { getApplications } from "@/applications/server";
import { getBilling } from "@/billing/server";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { contactEnrichmentFromEnv } from "./config";
import { createEnrichedContacts, type EnrichedContacts } from "./index";

let instance: EnrichedContacts | undefined;

/**
 * The app's Enriched Contacts, on the database named by DATABASE_URL and the
 * provider the environment selects (off without one, or until its DPA is
 * signed), counted against the Plan Quota's Enriched Contacts.
 */
export function getEnrichedContacts(): EnrichedContacts {
  if (!instance) {
    const config = contactEnrichmentFromEnv(process.env);
    if (!config.provider) console.info(`[enriched-contacts] off: ${config.disabledBecause}`);
    instance = createEnrichedContacts(new Pool({ connectionString: process.env.DATABASE_URL }), {
      applications: getApplications(),
      companyDossiers: getCompanyDossiers(),
      quota: {
        allows: (candidateId) => getBilling().allows(candidateId, "enrichedContacts"),
        use: (candidateId) => getBilling().use(candidateId, "enrichedContacts"),
        release: (candidateId) => getBilling().release(candidateId, "enrichedContacts"),
      },
      provider: config.provider,
    });
  }
  return instance;
}
