import type { ApplicationSection } from "@/routes";
import { ApplicationSectionPage, type Params } from "../sections";

const SECTION: ApplicationSection = "correspondance";

/** An Application's "correspondance" Section (ADR-0024): the Match Score's breakdown. */
export default function ApplicationCorrespondancePage({ params }: Params) {
  return <ApplicationSectionPage params={params} section={SECTION} />;
}
