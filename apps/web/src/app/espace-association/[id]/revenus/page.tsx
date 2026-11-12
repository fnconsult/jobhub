import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import {TaxPanel} from "@/coaching-tax/Panel";
import { notFound } from "next/navigation";
import { getCoachEarnings } from "@/coaching-earnings/server";
import { Earnings } from "@/coaching-earnings/Earnings";
import { getRequestLocale } from "@/i18n/server";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { COACHING_DEFAULT_ZONE } from "@jobhub/shared/coaching-time";
import { ConnectOnboarding } from "@/coaching-connect/ConnectOnboarding";
import { sharedPool } from "@/database/pool";
import { AssociationLayout } from "@/coach-associations/AssociationLayout";
import { requireAssociation } from "@/coach-associations/server";
import { getServerT } from "@/i18n/server";
const PAGE = "revenus";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mois?: string;fiscalYear?:string }> }) {
  requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0106): a 404.
  const { association, person } = await requireAssociation((await params).id),
    t = await getServerT();
  const seller = (await sharedPool().query<{ id: string }>("SELECT id FROM coaching_seller WHERE association_id=$1", [association.id])).rows[0];
  const query = await searchParams,
    statement = seller ? await getCoachEarnings().statement(person.id, seller.id, query.mois) : null;
  if (seller && !statement) notFound();
  return (
    <AssociationLayout association={association} page={PAGE}>
      <TaxPanel sellerId={seller?.id??null} year={Number(query.fiscalYear)}/>
      <ConnectOnboarding sellerId={seller?.id ?? null} />
      {statement ? (
        <Earnings
          statement={statement}
          path={`/espace-association/${association.id}/revenus`}
          locale={await getRequestLocale()}
          timeZone={(await getCoachingTimeZones().candidate(person.id)) ?? COACHING_DEFAULT_ZONE}
        />
      ) : (
        <section className="coach-space-card">
          <p>{t("association.earningsEmpty")}</p>
        </section>
      )}
    </AssociationLayout>
  );
}
