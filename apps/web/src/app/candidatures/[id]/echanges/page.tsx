import type { ApplicationSection } from "@/routes";
import { ApplicationSectionPage, type Params } from "../sections";

const SECTION: ApplicationSection = "echanges";

/**
 * An Application's "echanges" Section (#1099, ADR-0115): the emails about it kept on it, and those offered to tie to it.
 * Not « Correspondance », which details the Match Score. Only while APPLICATION_EXCHANGES_ENABLED is on (404 otherwise).
 */
export default function ApplicationExchangesPage({ params }: Params) {
  return <ApplicationSectionPage params={params} section={SECTION} />;
}
