import Link from "next/link";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { TextSizeControl } from "./TextSizeControl";

/** Header of a Human Coach's pages. */
export async function CoachSpaceHeader() {
  const t = await getServerT();
  return (
    <header className="page-header">
      <Link className="brand" href={routes.coachSpace}>
        {`${t("app.name")} · ${t("coachSpace.title")}`}
      </Link>
      <div className="page-nav">
        <TextSizeControl />
        <Link className="button" href={routes.account}>
          {t("nav.account")}
        </Link>
      </div>
    </header>
  );
}
