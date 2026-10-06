import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { AccountSettings } from "@/components/AccountSettings";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("account.title")} · ${t("app.name")}` };
}

export default async function AccountPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const t = await getServerT();
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
        <TextSizeControl />
      </header>
      <h1>{t("account.title")}</h1>
      <dl>
        <dt>{t("account.email")}</dt>
        <dd>{candidate.email}</dd>
      </dl>
      <AccountSettings interfaceLanguage={candidate.interfaceLanguage} />
    </main>
  );
}
