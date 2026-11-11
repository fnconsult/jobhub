import Link from "next/link";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { requireCoachSpace } from "./server";
import type { CoachSpacePage } from "./navigation";

const HELP = routes.helpTopic("espace-coach");

export async function CoachSpaceEmptyPage({ page }: { page: CoachSpacePage }) {
  await requireCoachSpace();
  const t = await getServerT();
  return <CoachSpaceShell><section className="coach-space-card"><h2>{t(`coachSpaceV2.pages.${page}`)}</h2><p>{t(`coachSpaceV2.empty.${page}`)}</p>{page === "aide" ? <Link href={HELP}>{t("coachSpaceV2.helpCentre")}</Link> : null}</section></CoachSpaceShell>;
}
