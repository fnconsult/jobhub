import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { SignInForm } from "@/components/SignInForm";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/** Codes a dead magic link comes back with; anything else (Google, OAuth state) is a failed sign-in. */
const MAGIC_LINK_ERRORS = new Set(["INVALID_TOKEN", "EXPIRED_TOKEN", "ATTEMPTS_EXCEEDED"]);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("signIn.title")} · ${t("app.name")}` };
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentCandidate()) redirect(routes.account);
  const t = await getServerT();
  const { error } = await searchParams;
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
      </header>
      <h1>{t("signIn.title")}</h1>
      <p className="lead">{t("signIn.intro")}</p>
      {error ? (
        <p className="notice" role="alert">
          {t(MAGIC_LINK_ERRORS.has(error) ? "signIn.linkError" : "signIn.failed")}
        </p>
      ) : null}
      <SignInForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} />
    </main>
  );
}
