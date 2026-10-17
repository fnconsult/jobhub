import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { signInCopy } from "@/auth/sign-in-copy";
import { SignInForm } from "@/components/SignInForm";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { signInButtons } from "@/sign-in-providers/policy";
import { currentSignInConfiguration } from "@/sign-in-providers/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("signIn.title")} · ${t("app.name")}` };
}

/** The Candidate sign-in: a magic link, or a Sign-in Provider shown to Candidates. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentCandidate()) redirect(routes.account);
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { error } = await searchParams;
  const providers = signInButtons(currentSignInConfiguration(), "candidates");
  const { intro, notice } = signInCopy({ providers: providers.map((provider) => provider.displayName), error }, locale);
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
      <SignInForm providers={providers} callbackURL={routes.account} errorURL={routes.signIn} />
    </main>
  );
}
