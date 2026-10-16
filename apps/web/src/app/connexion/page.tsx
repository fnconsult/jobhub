import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { googleClientFromEnv } from "@/auth/config";
import { getCurrentCandidate } from "@/auth/server";
import { signInCopy } from "@/auth/sign-in-copy";
import { SignInForm } from "@/components/SignInForm";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("signIn.title")} · ${t("app.name")}` };
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentCandidate()) redirect(routes.account);
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { error } = await searchParams;
  const googleEnabled = Boolean(googleClientFromEnv(process.env));
  const { intro, notice } = signInCopy({ googleEnabled, error }, locale);
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
      </header>
      <h1>{t("signIn.title")}</h1>
      <p className="lead">{intro}</p>
      {notice ? (
        <p className="notice" role="alert">
          {notice}
        </p>
      ) : null}
      <SignInForm googleEnabled={googleEnabled} />
    </main>
  );
}
