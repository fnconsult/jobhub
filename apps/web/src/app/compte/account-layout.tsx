import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { AccountSections } from "@/components/AccountSections";
import { getServerT } from "@/i18n/server";
import "./account.css";

export async function accountMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("account.title")} · ${t("app.name")}` };
}

/**
 * Mon compte, split into its Sections (ADR-0024): each a page of its own under /compte, in this frame. Two route
 * groups draw it, never one: the Sections a Candidate reaches while a CGU version waits for their Acceptance
 * ((open-before-acceptance): Mes données) and the others ((sections)). A layout is not drawn again on a client-side
 * navigation between the pages it holds, so the Acceptance gate it runs (CandidateLayout) would let a click from Mes
 * données into Préférences through (ADR-0062, #510). Between two groups, the frame is drawn again, and the gate runs.
 */
export async function AccountLayout({ children }: { children: ReactNode }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  return (
    <AccountSections candidateId={candidate.id}>
      <div className="account-section">{children}</div>
    </AccountSections>
  );
}
