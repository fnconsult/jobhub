import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { safeReturnPath, SESSION_EXPIRED } from "@/auth/sign-in-return";
import { signInCopy } from "@/auth/sign-in-copy";
import { SignInForm } from "@/components/SignInForm";
import { Note } from "@/design/Note";
import { PublicSite } from "@/design/PublicSite";
import { SignInStage } from "@/design/SignInStage";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { signInButtons } from "@/sign-in-providers/policy";
import { currentSignInConfiguration } from "@/sign-in-providers/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("signIn.title")} · ${t("app.name")}` };
}

/**
 * The Candidate sign-in (#470): a Sign-in Provider shown to Candidates, or a magic link; a failed sign-in as a Note.
 * `suite`: the page to come back to once signed in, a path of this site only; `raison`: « session expirée » (#542).
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; suite?: string; raison?: string }> }) {
  const { error, suite, raison } = await searchParams;
  const back = safeReturnPath(suite) ?? routes.account;
  if (await getCurrentCandidate()) redirect(back);
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const providers = signInButtons(currentSignInConfiguration(), "candidates");
  const { intro, notice } = signInCopy({ providers: providers.map((provider) => provider.displayName), error }, locale);
  return (
    <PublicSite signInLink={false}>
      <SignInStage
        title={t("signIn.title")}
        intro={intro}
        notices={
          <>
            {raison === SESSION_EXPIRED && !notice ? (
              <Note tone="info" role="status">
                {t("signIn.sessionExpired")}
              </Note>
            ) : null}
            {notice ? (
              <Note tone={notice.tone} role="alert">
                {notice.text}
              </Note>
            ) : null}
          </>
        }
      >
        <SignInForm providers={providers} callbackURL={back} errorURL={routes.signIn} />
      </SignInStage>
    </PublicSite>
  );
}
