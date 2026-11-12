// « Espace coach v2 » (ADR-0106): this page is a 404 while it is off.
import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PublicSite } from "@/design/PublicSite";
import { sharedPool } from "@/database/pool";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { ContentReportForm } from "@/coaching-content-reports/Form";
export const metadata = { robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ coach?: string; target?: string }> }) {
  requireCoachSpaceV2();
  const input = await searchParams;
  if (!z.uuid().safeParse(input.coach).success || !["page", "offer"].includes(input.target ?? "")) notFound();
  const target = input.target as "page" | "offer",
    id = input.coach!;
  const coach = (
    await sharedPool().query(
      "SELECT name FROM human_coach h WHERE id=$1 AND retired_at IS NULL AND public_ready AND NOT contract_pending AND ($2='page' OR EXISTS(SELECT 1 FROM coaching_offer o WHERE o.coach_id=h.id))",
      [id, target],
    )
  ).rows[0];
  if (!coach) notFound();
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  return (
    <PublicSite>
      <main className="page stack">
        <h1>{t("contentReport.title")}</h1>
        <p>{t(target === "page" ? "contentReport.pageTarget" : "contentReport.offerTarget", { name: coach.name })}</p>
        <p>{t("contentReport.intro")}</p>
        <ContentReportForm coachId={id} target={target} locale={locale} />
      </main>
    </PublicSite>
  );
}
