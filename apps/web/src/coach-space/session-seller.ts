import type { CoachingSeller } from "@jobhub/shared/coaching-offers";
import type { getServerT } from "@/i18n/server";

/**
 * Who sold this session, as frozen with its sale (#874, #1018): « Vendue par Jobbbox » for Jobbbox, else « Vendu par
 * <Seller> », the coach or their Association. Null, no line, for a session with no sale of its own.
 */
export function sessionSellerLine(seller: CoachingSeller | null, t: Awaited<ReturnType<typeof getServerT>>): string | null {
  if (!seller) return null;
  return seller.kind === "jobbbox" ? t("coachWorkspace.soldByJobbbox") : t("coachingOffers.soldBy", { name: seller.name });
}
