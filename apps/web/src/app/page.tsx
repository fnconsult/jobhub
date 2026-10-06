import { TextSizeControl } from "@/components/TextSizeControl";
import { getServerT } from "@/i18n/server";

export default function HomePage() {
  const t = getServerT();
  return (
    <main className="page">
      <header className="page-header">
        <span className="brand">{t("app.name")}</span>
        <TextSizeControl />
      </header>
      <h1>{t("home.title")}</h1>
      <p className="lead">{t("app.tagline")}</p>
      <p>{t("home.intro")}</p>
      <p className="notice">{t("home.comingSoon")}</p>
    </main>
  );
}
