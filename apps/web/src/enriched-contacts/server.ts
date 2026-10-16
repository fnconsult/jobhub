import { sharedPool } from "@/database/pool";
import { getApplications } from "@/applications/server";
import { getBilling } from "@/billing/server";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { CONTACT_ENRICHMENT_SECRET_NAMES } from "@/provider-secrets/catalog";
import { liveObject } from "@/provider-secrets/resolver";
import { getSecretResolver } from "@/provider-secrets/server";
import { contactEnrichmentFromSecrets } from "./config";
import { createEnrichedContacts, type EnrichedContacts } from "./index";

let instance: EnrichedContacts | undefined;

/**
 * The app's Enriched Contacts, on the database named by DATABASE_URL and the
 * provider the environment selects (off without one, or until its DPA is
 * signed), counted against the Plan Quota's Enriched Contacts. Rebuilt when the
 * provider's key is replaced in the Back Office (Provider Secrets).
 */
export function getEnrichedContacts(): EnrichedContacts {
  instance ??= liveObject(getSecretResolver(), CONTACT_ENRICHMENT_SECRET_NAMES, () => {
    // Its provider retries a refused key once with the database read afresh.
    const config = contactEnrichmentFromSecrets(getSecretResolver());
    if (!config.provider) console.info(`[enriched-contacts] off: ${config.disabledBecause}`);
    return createEnrichedContacts(sharedPool(), {
      applications: getApplications(),
      companyDossiers: getCompanyDossiers(),
      quota: {
        allows: (candidateId) => getBilling().allows(candidateId, "enrichedContacts"),
        use: (candidateId) => getBilling().use(candidateId, "enrichedContacts"),
        release: (candidateId) => getBilling().release(candidateId, "enrichedContacts"),
      },
      provider: config.provider,
    });
  });
  return instance;
}
