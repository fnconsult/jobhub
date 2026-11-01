import type { ApplicationSection } from "@/routes";
import { RESULT_PARAMETER } from "@/routes";
import { ApplicationSectionPage, type Params } from "../sections";

const SECTION: ApplicationSection = "documents";

/**
 * An Application's "documents" Section (ADR-0024): the Tailored Documents; under « Conversation au centre », one of them
 * alone when the address names it, a Result (#603).
 */
export default async function ApplicationDocumentsPage({ params, searchParams }: Params & { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ApplicationSectionPage params={params} section={SECTION} result={(await searchParams)[RESULT_PARAMETER]} />;
}
