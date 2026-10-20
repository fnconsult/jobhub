import type { ApplicationSection } from "@/routes";
import { ApplicationSectionPage, type Params } from "../sections";

const SECTION: ApplicationSection = "offre";

/** An Application's "offre" Section (ADR-0024): the full Job Offer. */
export default function ApplicationOffrePage({ params }: Params) {
  return <ApplicationSectionPage params={params} section={SECTION} />;
}
