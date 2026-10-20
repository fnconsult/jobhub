import type { ApplicationSection } from "@/routes";
import { ApplicationSectionPage, type Params } from "../sections";

const SECTION: ApplicationSection = "contacts";

/** An Application's "contacts" Section (ADR-0024): the Enriched Contacts. */
export default function ApplicationContactsPage({ params }: Params) {
  return <ApplicationSectionPage params={params} section={SECTION} />;
}
