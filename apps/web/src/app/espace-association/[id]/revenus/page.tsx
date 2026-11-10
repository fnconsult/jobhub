import {ConnectOnboarding} from "@/coaching-connect/ConnectOnboarding";
import {sharedPool} from "@/database/pool";
import { AssociationLayout } from "@/coach-associations/AssociationLayout";
import { requireAssociation } from "@/coach-associations/server";
import { getServerT } from "@/i18n/server";
const PAGE = "revenus";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { association } = await requireAssociation((await params).id),
    t = await getServerT();
  const seller=(await sharedPool().query<{id:string}>("SELECT id FROM coaching_seller WHERE association_id=$1",[association.id])).rows[0];
  return (
    <AssociationLayout association={association} page={PAGE}>
      <ConnectOnboarding sellerId={seller?.id??null}/><section className="coach-space-card">
        <p>{t("association.earningsEmpty")}</p>
      </section>
    </AssociationLayout>
  );
}
