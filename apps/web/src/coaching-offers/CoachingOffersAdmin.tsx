import { redirect } from "next/navigation";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getServerT } from "@/i18n/server";
import { Field, Select, TextInput } from "@/design/Field";
import { getCoachingOffers } from "./server";
const ID = "id",
  COACH = "coachId",
  SELLER = "sellerId",
  KIND = "kind",
  NAME = "name",
  STATUS = "status",
  SIRET = "siret",
  COMMISSION = "commissionBps",
  DURATION = "durationMinutes",
  AMOUNT = "amount";
const HUMAN = "human_coach",
  ASSOCIATION = "association";
const DESTINATION = "/admin/coachs";
async function saveSeller(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("humanCoaches", "write");
  const result = await getBackOffice().record(
    administrator,
    (within) =>
      getCoachingOffers().saveSeller(
        {
          kind: form.get(KIND),
          name: form.get(NAME),
          status: form.get(STATUS),
          siret: form.get(SIRET),
          coachId: form.get(COACH) || null,
          commissionBps: Number(form.get(COMMISSION)),
        },
        within,
      ),
    (seller) => (seller ? { section: "human_coaches", target: seller.id, action: "added", before: null, after: { ...seller } } : null),
  );
  redirect(result ? DESTINATION : `${DESTINATION}?error=offer`);
}
async function commission(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("humanCoaches", "write");
  const id = String(form.get(ID));
  const value = Number(form.get(COMMISSION));
  const changed = await getBackOffice().record(
    administrator,
    async (within) => {
      const before = (await within.query('SELECT commission_bps AS "commissionBps" FROM coaching_seller WHERE id=$1 FOR UPDATE', [id])).rows[0];
      return (await getCoachingOffers().commission(id, value, within)) ? { before, after: { commissionBps: value } } : null;
    },
    (change) => (change ? { section: "human_coaches", target: id, action: "updated", ...change } : null),
  );
  redirect(changed ? DESTINATION : `${DESTINATION}?error=offer`);
}
async function saveOffer(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("humanCoaches", "write");
  const coachId = String(form.get(COACH));
  const input = {
    coachId,
    sellerId: String(form.get(SELLER) ?? ""),
    durationMinutes: Number(form.get(DURATION)),
    amount: form.get(AMOUNT) ? Number(form.get(AMOUNT)) : null,
  };
  const changed = await getBackOffice().record(
    administrator,
    async (within) => {
      const before =
        (await within.query("SELECT seller_id,duration_minutes,amount,currency FROM coaching_offer WHERE coach_id=$1 FOR UPDATE", [coachId])).rows[0] ?? null;
      return (await getCoachingOffers().saveOffer(input, within)) ? { before, after: input } : null;
    },
    (change) => (change ? { section: "human_coaches", target: coachId, action: "updated", ...change } : null),
  );
  redirect(changed ? DESTINATION : `${DESTINATION}?error=offer`);
}
/** All writes are behind the coaching role and in the same transaction as their audit. */
export async function CoachingOffersAdmin({ canWrite }: { canWrite: boolean }) {
  const t = await getServerT();
  const [coaches, offers, sellers] = await Promise.all([getHumanCoaches().list({includePending:true}), getCoachingOffers().all(), getCoachingOffers().sellers()]);
  return (
    <section className="section-block stack">
      <h2>{t("coachingOffers.adminTitle")}</h2>
      <p>{t("coachingOffers.locked")}</p>
      {sellers.map((seller) => (
        <form className="stack" action={commission} key={seller.id}>
          <h3>{seller.name}</h3>
          <input type="hidden" name={ID} value={seller.id} />
          <Field label={t("coachingOffers.commission")}>
            <TextInput type="number" name={COMMISSION} min={0} max={10000} defaultValue={seller.commissionBps} required disabled={!canWrite} />
          </Field>
          {canWrite ? (
            <button className="button" type="submit">
              {t("coachingOffers.saveCommission")}
            </button>
          ) : null}
        </form>
      ))}
      {offers.map((offer) => (
        <form className="stack" action={saveOffer} key={offer.id}>
          <h3>{coaches.find((coach) => coach.id === offer.coachId)?.name}</h3>
          <input type="hidden" name={COACH} value={offer.coachId} />
          <Field label={t("coachingOffers.seller")}>
            <Select name={SELLER} defaultValue={offer.seller.id} disabled={!canWrite}>
              {sellers
                .filter((seller) => seller.kind !== HUMAN || seller.coachId === offer.coachId)
                .map((seller) => (
                  <option value={seller.id} key={seller.id}>
                    {seller.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t("coachingOffers.duration")}>
            <TextInput type="number" name={DURATION} min={15} max={480} defaultValue={offer.durationMinutes} required disabled={!canWrite} />
          </Field>
          <Field label={t("coachingOffers.amount")}>
            <TextInput type="number" name={AMOUNT} min={50} max={1000000} defaultValue={offer.amount ?? ""} disabled={!canWrite} />
          </Field>
          {canWrite ? (
            <button className="button" type="submit">
              {t("coachingOffers.save")}
            </button>
          ) : null}
        </form>
      ))}
      {canWrite ? (
        <form className="stack" action={saveSeller}>
          <h3>{t("coachingOffers.addSeller")}</h3>
          <Field label={t("coachingOffers.kind")}>
            <Select name={KIND}>
              <option value={HUMAN}>{t("coachingOffers.coach")}</option>
              <option value={ASSOCIATION}>{t("coachingOffers.association")}</option>
            </Select>
          </Field>
          <Field label={t("coachingOffers.coach")}>
            <Select name={COACH}>
              <option value="">—</option>
              {coaches.map((coach) => (
                <option value={coach.id} key={coach.id}>
                  {coach.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("coachingOffers.sellerName")}>
            <TextInput name={NAME} required maxLength={160} />
          </Field>
          <Field label={t("coachingOffers.status")}>
            <TextInput name={STATUS} required maxLength={120} />
          </Field>
          <Field label={t("coachingOffers.siretLabel")}>
            <TextInput name={SIRET} required pattern="[0-9]{14}" maxLength={14} />
          </Field>
          <Field label={t("coachingOffers.commission")}>
            <TextInput type="number" name={COMMISSION} min={0} max={10000} defaultValue={0} required />
          </Field>
          <button className="button" type="submit">
            {t("coachingOffers.addSeller")}
          </button>
        </form>
      ) : null}
    </section>
  );
}
