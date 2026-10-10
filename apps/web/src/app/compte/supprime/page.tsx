import type { Metadata } from "next";
import Link from "next/link";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("accountDeleted.title")} · ${t("app.name")}` };
}

/** Where a Candidate lands once they deleted their account. */
export default async function AccountDeletedPage() {
  const t = await getServerT();
  return (
    <main className="page stack">
      <h1>{t("accountDeleted.title")}</h1>
      <p>{t("accountDeleted.body")}</p>
      <Link className="button" href={routes.home}>
        {t("accountDeleted.home")}
      </Link>
    </main>
  );
}
