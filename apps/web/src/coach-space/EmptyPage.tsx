import Link from "next/link";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { Card } from "@/design/Card";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { requireCoachSpace } from "./server";
import type { CoachSpacePage } from "./navigation";

const HELP = routes.helpTopic("espace-coach");

export async function CoachSpaceEmptyPage({ page }: { page: CoachSpacePage }) {
  await requireCoachSpace();
  const t = await getServerT();
  return <CoachSpaceShell><Card title={t(`coachSpaceV2.pages.${page}`)}><p>{t(`coachSpaceV2.empty.${page}`)}</p>{page === "aide" ? <Link href={HELP}>{t("coachSpaceV2.helpCentre")}</Link> : null}</Card></CoachSpaceShell>;
}
