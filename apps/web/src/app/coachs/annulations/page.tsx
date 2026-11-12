// « Espace coach v2 » (ADR-0106): this page is a 404 while it is off.
import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import {CandidateCancellationList} from "@/coaching-cancellations/CandidateList";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CancellationPanel } from "@/coaching-cancellations/Panel";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getCoachingTimeZones } from "@/coaching-time/server";
export default async function Page() {
  requireCoachSpaceV2();
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const locale = await getRequestLocale(),
    t = await getServerT(locale);
  const timeZone=await getCoachingTimeZones().candidate(candidate.id)??"Europe/Paris";
  return (
    <CandidateLayout candidateId={candidate.id} title={t("coachingCancellation.title")}>
      <CandidateCancellationList candidateId={candidate.id} locale={locale} timeZone={timeZone}/>
      <CancellationPanel candidateId={candidate.id} locale={locale} timeZone={timeZone} />
    </CandidateLayout>
  );
}
