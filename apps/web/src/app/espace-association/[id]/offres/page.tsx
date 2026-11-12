import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { AssociationLayout } from "@/coach-associations/AssociationLayout";
import { requireAssociation } from "@/coach-associations/server";
import { saveOffer } from "@/coach-associations/actions";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput, Select } from "@/design/Field";
import { Note } from "@/design/Note";
import { getServerT } from "@/i18n/server";
const F = { associationId: "associationId", coachId: "coachId", seller: "seller", duration: "durationMinutes", amount: "amount" },
  ASSOCIATION = "association",
  JOBBBOX = "jobbbox";
const PAGE = "offres";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0107): a 404.
  const { id } = await params,
    { person, association, associations } = await requireAssociation(id),
    t = await getServerT(),
    offers = await associations.offers(person, id),
    query = await searchParams;
  return (
    <AssociationLayout association={association} page={PAGE}>
      {query.error ? (
        <Note tone="danger" role="alert">
          {t("association.invalid")}
        </Note>
      ) : null}
      {query.saved ? (
        <Note tone="success" role="status">
          {t("association.offerSaved")}
        </Note>
      ) : null}
      <p>{t("association.offersHint")}</p>
      {!offers?.offers.length ? (
        <p>{t("association.noCoaches")}</p>
      ) : (
        offers.offers.map((offer) => (
          <form action={saveOffer} key={offer.coachId}>
            <Card title={offer.name}>
              <div className="stack">
                <input type="hidden" name={F.associationId} value={id} />
                <input type="hidden" name={F.coachId} value={offer.coachId} />
                <Field label={t("association.seller")}>
                  <Select name={F.seller} defaultValue={offer.sellerId === offers.sellerId && offers.sellerId ? ASSOCIATION : JOBBBOX}>
                    <option value={JOBBBOX}>{t("app.name")}</option>
                    <option value={ASSOCIATION}>{association.name}</option>
                  </Select>
                </Field>
                <Field label={t("association.duration")}>
                  <TextInput name={F.duration} type="number" min={15} max={480} step={1} required defaultValue={offer.durationMinutes} />
                </Field>
                <Field label={t("association.amount")}>
                  <TextInput name={F.amount} type="number" min={0.5} max={10000} step={0.01} defaultValue={offer.amount === null ? "" : offer.amount / 100} />
                </Field>
                <button className={buttonClass({ variant: "primary" })} type="submit">
                  {t("association.save")}
                </button>
              </div>
            </Card>
          </form>
        ))
      )}
    </AssociationLayout>
  );
}
