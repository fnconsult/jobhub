import type { ApplicationSection } from "@/routes";
import { ApplicationSectionPage, type Params } from "../sections";

const SECTION: ApplicationSection = "avis";

/** An Application's "avis" Section (ADR-0024): the Human Coaches' Coach Reviews. */
export default function ApplicationAvisPage({ params }: Params) {
  return <ApplicationSectionPage params={params} section={SECTION} />;
}
