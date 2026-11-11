import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { requireCoachSpace } from "@/coach-space/server";
import { requireAssociation } from "@/coach-associations/server";
import { getServerT } from "@/i18n/server";
import { sharedPool } from "@/database/pool";
import { getCoachingConnect } from "./server";
import { connectLegalReady } from "./legal";
const SELLER = "sellerId",
  OPERATION = "operation",
  ONBOARD = "onboard",
  DASHBOARD = "dashboard";
async function openConnect(form: FormData) {
  "use server";
  const sellerId = String(form.get(SELLER)),
    person = await getCurrentCandidate();
  if (!person || !/^[0-9a-f-]{36}$/i.test(sellerId)) notFound();
  const seller = (
    await sharedPool().query<{ kind: string; coachId: string | null; associationId: string | null }>(
      `SELECT kind,coach_id AS "coachId",association_id AS "associationId" FROM coaching_seller WHERE id=$1`,
      [sellerId],
    )
  ).rows[0];
  if (!seller) notFound();
  let returnPath: string;
  if (seller.kind === "human_coach") {
    const coach = await requireCoachSpace();
    if (coach.id !== seller.coachId) notFound();
    returnPath = "/espace-coach/revenus";
  } else if (seller.kind === "association" && seller.associationId) {
    await requireAssociation(seller.associationId);
    returnPath = `/espace-association/${seller.associationId}/revenus`;
  } else notFound();
  const connect = getCoachingConnect(),
    url = form.get(OPERATION) === DASHBOARD ? await connect.dashboard(sellerId, person.id) : await connect.onboarding(sellerId, returnPath, person.id);
  redirect(url ?? `${returnPath}?connect=unavailable`);
}
export async function ConnectOnboarding({ sellerId }: { sellerId: string | null }) {
  const t = await getServerT();
  if (!connectLegalReady()) return <p>{t("coachConnect.legalPending")}</p>;
  if (!sellerId) return <p>{t("coachConnect.identityPending")}</p>;
  const seller = await getCoachingConnect().seller(sellerId);
  return (
    <section className="coach-space-card stack">
      <h2>{t("coachConnect.accountTitle")}</h2>
      <p>{t("coachConnect.hostedKyc")}</p>
      <form action={openConnect}>
        <input type="hidden" name={SELLER} value={sellerId} />
        <button className="button" name={OPERATION} value={ONBOARD}>
          {t(seller?.accountId ? "coachConnect.complete" : "coachConnect.start")}
        </button>
        {seller?.accountId ? (
          <button className="button" name={OPERATION} value={DASHBOARD}>
            {t("coachConnect.dashboard")}
          </button>
        ) : null}
      </form>
    </section>
  );
}
