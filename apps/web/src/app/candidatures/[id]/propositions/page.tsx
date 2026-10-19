import type { ApplicationSection } from "@/routes";
import { ApplicationSectionPage, type Params } from "../sections";

const SECTION: ApplicationSection = "propositions";

/** An Application's "propositions" Section (ADR-0024): the AI Coach's Action Cards. */
export default function ApplicationPropositionsPage({ params }: Params) {
  return <ApplicationSectionPage params={params} section={SECTION} />;
}
