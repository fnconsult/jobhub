import type { Metadata } from "next";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { JobSearchesMenuPage, type JobSearchesPane } from "@/components/JobSearchesMenuPage";
import { OfferBoxFilterProvider, OfferBoxTopBarTitle } from "@/components/OfferBox";
import { getServerT } from "@/i18n/server";
import { readOfferBox } from "@/offer-box/server";
import "./recherches.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("sidebar.jobSearches")} · ${t("app.name")}` };
}

/** What the address opens in the Work Pane: « profils=1 » the Job Searches by Profile, « recues=1 » « Reçues par email » (#447), « offre=… » a Job Offer of the Offer box. */
function paneOf(params: { profils?: string; recues?: string; offre?: string }): JobSearchesPane {
  if (typeof params.offre === "string" && params.offre) return { kind: "offer", jobOfferId: params.offre };
  if (params.profils !== undefined) return { kind: "byProfile" };
  if (params.recues !== undefined) return { kind: "received" };
  return null;
}

/**
 * Recherches d'offres (ADR-0090, amending ADR-0070): the Offer box (« Offres à traiter ») is the page, the menu's
 * conversation following it (see JobSearchesMenuPage); « Recherches par Profil », « Reçues par email » and an entry's Job
 * Offer open in the Work Pane at their own addresses. On a phone, the Offer box's header is behind the filter icon of the
 * Top Bar, beside the title (#898): its filter is held around the layout, for the Top Bar and the page.
 */
export default async function JobSearchesPage({ searchParams }: { searchParams: Promise<{ profils?: string; recues?: string; offre?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [t, params, box] = await Promise.all([getServerT(), searchParams, readOfferBox(candidate.id)]);
  return (
    <OfferBoxFilterProvider toHandle={box.toHandle}>
      <CandidateLayout candidateId={candidate.id} title={<OfferBoxTopBarTitle title={t("sidebar.jobSearches")} />}>
        <JobSearchesMenuPage candidateId={candidate.id} pane={paneOf(params)} />
      </CandidateLayout>
    </OfferBoxFilterProvider>
  );
}
