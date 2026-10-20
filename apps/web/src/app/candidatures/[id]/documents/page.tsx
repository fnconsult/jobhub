import type { ApplicationSection } from "@/routes";
import { ApplicationSectionPage, type Params } from "../sections";

const SECTION: ApplicationSection = "documents";

/** An Application's "documents" Section (ADR-0024): the Tailored Documents. */
export default function ApplicationDocumentsPage({ params }: Params) {
  return <ApplicationSectionPage params={params} section={SECTION} />;
}
