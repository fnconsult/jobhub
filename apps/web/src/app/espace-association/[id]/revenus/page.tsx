import { AssociationLayout } from "@/coach-associations/AssociationLayout";
import { requireAssociation } from "@/coach-associations/server";
import { getServerT } from "@/i18n/server";
const PAGE = "revenus";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { association } = await requireAssociation((await params).id),
    t = await getServerT();
  return (
    <AssociationLayout association={association} page={PAGE}>
      <section className="coach-space-card">
        <p>{t("association.earningsEmpty")}</p>
      </section>
    </AssociationLayout>
  );
}
