import Link from "next/link";
import { getCurrentCandidate } from "@/auth/server";
import { routes } from "@/routes";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getServerT } from "@/i18n/server";

export default async function HomePage() {
  const t = await getServerT();
  const candidate = await getCurrentCandidate();
  return (
    <main className="page">
      <header className="page-header">
        <span className="brand">{t("app.name")}</span>
        <nav className="page-nav">
          <TextSizeControl />
          <Link className="button" href={candidate ? routes.account : routes.signIn}>
            {candidate ? t("nav.account") : t("nav.signIn")}
          </Link>
        </nav>
      </header>
      <h1>{t("home.title")}</h1>
      <p className="lead">{t("app.tagline")}</p>
      <p>{t("home.intro")}</p>
      <p className="notice">{t("home.comingSoon")}</p>
    </main>
  );
}
