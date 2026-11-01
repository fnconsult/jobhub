import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

type Props = { searchParams: Promise<{ token?: string; done?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  // In the language the URL's `lang` chose (src/proxy.ts), like <html lang>.
  const t = await getServerT();
  return { title: `${t("jobDigest.unsubscribePage.title")} · ${t("app.name")}` };
}

/**
 * Where a Job Digest email's unsubscribe link leads: no sign-in needed. It asks
 * before unsubscribing (mail scanners open links), then says it is done. A
 * public page (#544), under its header and above its footer.
 */
export default async function JobDigestUnsubscribePage({ searchParams }: Props) {
  const { token, done } = await searchParams;
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const action = `/api/job-digests/unsubscribe?${new URLSearchParams({ token: token ?? "", lang: locale })}`;
  return (
    <PublicSite>
      <main id="main" className="ds-site__page ds-site__narrow">
        <h1 className="ds-site__title">{t("jobDigest.unsubscribePage.title")}</h1>
        {done === "1" ? (
          <Note tone="success" role="status">
            {t("jobDigest.unsubscribePage.done")}
          </Note>
        ) : done === "0" || !token ? (
          <Note tone="warn" role="alert">
            {t("jobDigest.unsubscribePage.invalid")}
          </Note>
        ) : (
          <form className="ds-site__narrow" method="post" action={action}>
            <p>{t("jobDigest.unsubscribePage.confirm")}</p>
            <div>
              <button className={buttonClass({ variant: "primary" })} type="submit">
                {t("jobDigest.unsubscribePage.action")}
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
