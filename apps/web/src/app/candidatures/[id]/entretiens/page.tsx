import type { ApplicationSection } from "@/routes";
import { ApplicationSectionPage, type Params } from "../sections";

const SECTION: ApplicationSection = "entretiens";

/** An Application's "entretiens" Section (ADR-0024): the Interviews. */
export default function ApplicationEntretiensPage({ params }: Params) {
  return <ApplicationSectionPage params={params} section={SECTION} />;
}
