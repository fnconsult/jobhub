import Link from "next/link";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/** Header of every back-office page. */
export async function BackOfficeHeader() {
  const t = await getServerT();
  return (
    <header className="page-header">
      <Link className="brand" href={routes.admin}>
        {`${t("app.name")} · ${t("admin.title")}`}
      </Link>
      <Link className="button" href={routes.account}>
        {t("nav.account")}
      </Link>
    </header>
  );
}
