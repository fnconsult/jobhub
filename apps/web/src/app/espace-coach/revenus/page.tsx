import {TaxPanel} from "@/coaching-tax/Panel";
import { notFound } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { getCoachEarnings } from "@/coaching-earnings/server";
import { Earnings } from "@/coaching-earnings/Earnings";
import { getRequestLocale } from "@/i18n/server";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { requireCoachSpace } from "@/coach-space/server";
import { ConnectOnboarding } from "@/coaching-connect/ConnectOnboarding";
import { sharedPool } from "@/database/pool";
const PAGE = "/espace-coach/revenus";
export default async function Page({ searchParams }: { searchParams: Promise<{ mois?: string;fiscalYear?:string }> }) {
  const coach = await requireCoachSpace(),
    seller = (await sharedPool().query<{ id: string }>("SELECT id FROM coaching_seller WHERE kind='human_coach' AND coach_id=$1", [coach.id])).rows[0];
  const person = await getCurrentCandidate(),
    query = await searchParams,
    statement = person && seller ? await getCoachEarnings().statement(person.id, seller.id, query.mois) : null;
  if (seller && !statement) notFound();
  return (
    <CoachSpaceShell>
      <TaxPanel sellerId={seller?.id??null} year={Number(query.fiscalYear)}/>
      <ConnectOnboarding sellerId={seller?.id ?? null} />
      {statement ? (
        <Earnings statement={statement} path={PAGE} locale={await getRequestLocale()} timeZone={await getCoachingTimeZones().coach(coach.id)} />
      ) : null}
    </CoachSpaceShell>
  );
}
