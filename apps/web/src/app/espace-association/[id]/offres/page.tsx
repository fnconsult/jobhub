import { AssociationLayout } from "@/coach-associations/AssociationLayout";
import { requireAssociation } from "@/coach-associations/server";
import { saveOffer } from "@/coach-associations/actions";
import { Field, TextInput, Select } from "@/design/Field";
import { getServerT } from "@/i18n/server";
const F = { associationId: "associationId", coachId: "coachId", seller: "seller", duration: "durationMinutes", amount: "amount" },
  ASSOCIATION = "association",
  JOBBBOX = "jobbbox";
const PAGE = "offres";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { id } = await params,
    { person, association, associations } = await requireAssociation(id),
    t = await getServerT(),
    offers = await associations.offers(person, id),
    query = await searchParams;
  return (
    <AssociationLayout association={association} page={PAGE}>
      {query.error ? <p role="alert">{t("association.invalid")}</p> : null}
      {query.saved ? <p role="status">{t("association.offerSaved")}</p> : null}
      <p>{t("association.offersHint")}</p>
      {!offers?.offers.length ? (
        <p>{t("association.noCoaches")}</p>
      ) : (
        offers.offers.map((offer) => (
          <form className="coach-space-card stack" action={saveOffer} key={offer.coachId}>
            <h2>{offer.name}</h2>
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
            <button className="button" type="submit">
              {t("association.save")}
            </button>
          </form>
        ))
      )}
    </AssociationLayout>
  );
}
