import { sharedPool } from "@/database/pool";
import { getAi } from "@/ai/server";
import { getApplications } from "@/applications/server";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { getEnrichedContacts } from "@/enriched-contacts/server";
import { getProfiles } from "@/profiles/server";
import { getTaskPlaybooks } from "@/task-playbooks/server";
import { createTailoredDocuments, type TailoredDocuments } from "./index";
import { createTailoredDocumentVersions, type TailoredDocumentVersions } from "./versions";

let instance: TailoredDocuments | undefined;

/**
 * The app's Tailored Documents module, on the database named by DATABASE_URL.
 * Drafts draw on the Application's Company Dossier (#17) and its Suggested
 * Contact Roles once one is built, and on the Master CV and the Job Offer alone until then.
 * An Outreach Message can be addressed to one of the Application's Enriched Contacts (#23).
 */
export function getTailoredDocuments(): TailoredDocuments {
  instance ??= createTailoredDocuments(sharedPool(), {
    applications: getApplications(),
    profiles: getProfiles(),
    ai: getAi(),
    companyDossiers: getCompanyDossiers(),
    enrichedContacts: getEnrichedContacts(),
    taskPlaybooks: getTaskPlaybooks(),
  });
  return instance;
}

let versions: TailoredDocumentVersions | undefined;

/** The app's Tailored Document Versions module (#1079): the earlier versions of the Tailored CV, Cover Letter and Outreach Message. */
export function getTailoredDocumentVersions(): TailoredDocumentVersions {
  versions ??= createTailoredDocumentVersions(sharedPool(), { applications: getApplications() });
  return versions;
}
