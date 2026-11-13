import type { CoachingSeller } from "@jobhub/shared/coaching-offers";
import type { getServerT } from "@/i18n/server";
export function SellerInfo({ seller, t }: { seller: CoachingSeller; t: Awaited<ReturnType<typeof getServerT>> }) {
  return (
    <div className="coaching-seller">
      <p>{t("coachingOffers.soldBy", { name: seller.name })}</p>
      {seller.kind !== "jobbbox" ? (
        <>
          <p>
            {seller.status} · {t("coachingOffers.siret", { siret: seller.siret })}
          </p>
          <p>{t("coachingOffers.marketplace")}</p>
        </>
      ) : null}
    </div>
  );
}
