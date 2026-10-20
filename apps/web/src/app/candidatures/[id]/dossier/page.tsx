import type { ApplicationSection } from "@/routes";
import { ApplicationSectionPage, type Params } from "../sections";

const SECTION: ApplicationSection = "dossier";

/** An Application's "dossier" Section (ADR-0024): the Company Dossier. */
export default function ApplicationDossierPage({ params }: Params) {
  return <ApplicationSectionPage params={params} section={SECTION} />;
}
