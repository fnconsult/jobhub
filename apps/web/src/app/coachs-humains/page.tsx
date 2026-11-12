import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingCoach } from "@/components/LandingCoach";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
import { readHumanCoachPath } from "@/landing/server";
import { publicMetadata } from "@/public-pages/indexing-server";
import { routes } from "@/routes";

/** Indexed in French and in English once the path is switched on; its own title and description (ADR-0105). */
export async function generateMetadata(): Promise<Metadata> {
  if (!readHumanCoachPath()) return {};
  const t = await getServerT();
  const title = t("landing.coachPath.meta.title");
  const description = t("landing.coachPath.meta.description");
  return { ...(await publicMetadata(routes.humanCoachLanding, ["fr", "en"])), title, description, openGraph: { type: "website", siteName: t("app.name"), title, description } };
}

/**
 * The Human Coaches' path on the public site (ADR-0105): the landing page's design, for the other audience. Behind
 * HUMAN_COACH_PAGE_ENABLED: while it is off, this address answers 404, as if the page did not exist.
 */
export default async function HumanCoachLandingPage() {
  if (!readHumanCoachPath()) notFound();
  return (
    <PublicSite>
      <LandingCoach />
    </PublicSite>
  );
}
