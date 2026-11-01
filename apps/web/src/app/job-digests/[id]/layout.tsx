import type { ReactNode } from "react";
import { pagesAreConversations } from "@/components/ObjectConversation";
import { JobDigestConversation } from "./conversation";
import { loadJobDigestPage, type Params } from "./job-digest-page";

/**
 * Every page of a Job Digest: under « Conversation au centre » (#605, ADR-0070), the Job Digest's conversation and its
 * Fiche, around what the address opens in the Work Pane (its Job Offers, one of them, or its settings). Otherwise the page
 * lays itself out.
 */
export default async function JobDigestLayout({ params, children }: Params & { children: ReactNode }) {
  if (!pagesAreConversations()) return children;
  return <JobDigestConversation data={await loadJobDigestPage((await params).id)}>{children}</JobDigestConversation>;
}
