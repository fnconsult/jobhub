import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { backOfficeSignInState } from "@/admin/server";
import { signInCopy } from "@/auth/sign-in-copy";
import { SignInForm } from "@/components/SignInForm";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { signInButtons } from "@/sign-in-providers/policy";
import { currentSignInConfiguration } from "@/sign-in-providers/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("backOfficeSignIn.title")} · ${t("app.name")}`, robots: { index: false } };
}

/**
 * The Back Office sign-in: a magic link, or any Sign-in Provider allowed for Administrators,
 * shown to Candidates or not. Require SSO for Administrators sends an Administrator signed in
 * by magic link here, to sign in again with one of those providers.
 */
export default async function BackOfficeSignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const state = await backOfficeSignInState();
  // Signed in without a Back Office Role: the Back Office stays unseen.
  if (state === "not_administrator") notFound();
  if (state === "signed_in") redirect(routes.admin);
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { error } = await searchParams;
  const providers = signInButtons(currentSignInConfiguration(), "administrators");
  const { intro, notice } = signInCopy({ providers: providers.map((provider) => provider.displayName), error }, locale);
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
      </header>
      <h1>{t("backOfficeSignIn.title")}</h1>
      {state === "needs_sso" ? (
        <p className="notice" role="status">
          {providers.length > 0 ? t("backOfficeSignIn.ssoRequired") : t("backOfficeSignIn.ssoRequiredNoProvider")}
        </p>
      ) : (
        <p className="lead">{intro}</p>
      )}
      {notice ? (
        <p className="notice" role="alert">
          {notice}
        </p>
      ) : null}
      <SignInForm providers={providers} callbackURL={routes.admin} errorURL={routes.backOfficeSignIn} magicLink={state !== "needs_sso"} />
      {state === "needs_sso" ? (
        <p>
          <Link href={routes.account}>{t("backOfficeSignIn.backToAccount")}</Link>
        </p>
      ) : null}
    </main>
  );
}
