import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

type Props = { searchParams: Promise<{ token?: string; done?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("nouveautesEmail.unsubscribePage.title")} · ${t("app.name")}` };
}

/**
 * Where a Nouveautés email's unsubscribe link leads (#566): no sign-in needed, as for the Job Digest. It asks before
 * unsubscribing (mail scanners open links), then says it is done. A public page.
 */
export default async function NouveautesEmailUnsubscribePage({ searchParams }: Props) {
  const { token, done } = await searchParams;
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const action = `/api/nouveautes-email/unsubscribe?${new URLSearchParams({ token: token ?? "", lang: locale })}`;
  return (
    <PublicSite>
      <main id="main" className="ds-site__page ds-site__narrow">
        <h1 className="ds-site__title">{t("nouveautesEmail.unsubscribePage.title")}</h1>
        {done === "1" ? (
          <Note tone="success" role="status">
            {t("nouveautesEmail.unsubscribePage.done")}
          </Note>
        ) : done === "0" || !token ? (
          <Note tone="warn" role="alert">
            {t("nouveautesEmail.unsubscribePage.invalid")}
          </Note>
        ) : (
          <form className="ds-site__narrow" method="post" action={action}>
            <p>{t("nouveautesEmail.unsubscribePage.confirm")}</p>
            <div>
              <button className={buttonClass({ variant: "primary" })} type="submit">
                {t("nouveautesEmail.unsubscribePage.action")}
              </button>
            </div>
          </form>
        )}
        <p>
          <Link href={routes.home}>{t("notFound.backHome")}</Link>
        </p>
      </main>
    </PublicSite>
  );
}
