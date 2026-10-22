import { getExternalApiLog } from "@/ai-usage/server";
import { sharedPool } from "@/database/pool";
import { getApplications } from "@/applications/server";
import { getBilling } from "@/billing/server";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { secretsOverPlatformSettings } from "@/platform-settings/resolver";
import { getSecretResolver } from "@/provider-secrets/server";
import { liveContactEnrichment } from "./config";
import { createEnrichedContacts, type EnrichedContacts } from "./index";

let instance: EnrichedContacts | undefined;

/**
 * The app's Enriched Contacts, on the database named by DATABASE_URL and the
 * provider chosen on Paramètres, else env (off without one, or until its DPA is
 * marked signed), counted against the Plan Quota's Enriched Contacts. Rebuilt when
 * the provider or the DPA changes on Paramètres, or its key in Clés (#302).
 */
export function getEnrichedContacts(): EnrichedContacts {
  // Its provider retries a refused key once with the database read afresh.
  instance ??= liveContactEnrichment(
    secretsOverPlatformSettings(getSecretResolver(), getPlatformSettingsResolver()),
    (config) => {
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
    },
    { externalApis: getExternalApiLog() },
  );
  return instance;
}
