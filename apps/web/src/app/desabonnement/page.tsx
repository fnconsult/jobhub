import type { Metadata } from "next";
import Link from "next/link";
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
 * before unsubscribing (mail scanners open links), then says it is done.
 */
export default async function JobDigestUnsubscribePage({ searchParams }: Props) {
  const { token, done } = await searchParams;
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const action = `/api/job-digests/unsubscribe?${new URLSearchParams({ token: token ?? "", lang: locale })}`;
  return (
    <main className="page">
      <header className="page-header">
        <span className="brand">{t("app.name")}</span>
      </header>
      <h1>{t("jobDigest.unsubscribePage.title")}</h1>
      {done === "1" ? (
        <p className="notice" role="status">
          {t("jobDigest.unsubscribePage.done")}
        </p>
      ) : done === "0" || !token ? (
        <p className="notice" role="alert">
          {t("jobDigest.unsubscribePage.invalid")}
        </p>
      ) : (
        <form className="stack" method="post" action={action}>
          <p>{t("jobDigest.unsubscribePage.confirm")}</p>
          <div className="actions">
            <button className="button button-primary" type="submit">
              {t("jobDigest.unsubscribePage.action")}
            </button>
          </div>
        </form>
      )}
      <p>
        <Link href={routes.home}>{t("notFound.backHome")}</Link>
      </p>
    </main>
  );
}
