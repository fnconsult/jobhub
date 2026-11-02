import type { ReactNode } from "react";
import { JobSearchConversation } from "./conversation";
import { loadJobSearchPage, type Params } from "./job-search-page";

/**
 * Every page of a Job Search (#605, ADR-0070): the Job Search's conversation and its Fiche, around what the address opens
 * in the Work Pane (its Job Offers, or one of them).
 */
export default async function JobSearchLayout({ params, children }: Params & { children: ReactNode }) {
  return <JobSearchConversation data={await loadJobSearchPage((await params).id)}>{children}</JobSearchConversation>;
}
