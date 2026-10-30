import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/design/button-class";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("accountDeleted.title")} · ${t("app.name")}` };
}

/** Where a Candidate lands once they deleted their account: a public page (#544), under its header and above its footer. */
export default async function AccountDeletedPage() {
  const t = await getServerT();
  return (
    <PublicSite>
      <main id="main" className="ds-site__page ds-site__narrow">
        <h1 className="ds-site__title">{t("accountDeleted.title")}</h1>
        <p>{t("accountDeleted.body")}</p>
        <div>
          <Link className={buttonClass()} href={routes.home}>
            {t("accountDeleted.home")}
          </Link>
        </div>
      </main>
    </PublicSite>
  );
}
