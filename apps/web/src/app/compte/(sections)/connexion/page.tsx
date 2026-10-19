import { redirect } from "next/navigation";
import { currentIsAdministrator } from "@/admin/server";
import { getCurrentCandidate, linkedSignInProviders } from "@/auth/server";
import { SignInMethods } from "@/components/SignInMethods";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { linkableProviders } from "@/sign-in-providers/policy";
import { currentSignInConfiguration } from "@/sign-in-providers/server";

/** Mon compte's Sign-in Section: the account's email address and its sign-in methods. */
export default async function AccountSignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const [t, isAdministrator, linkedIds, { error }] = await Promise.all([getServerT(), currentIsAdministrator(), linkedSignInProviders(), searchParams]);
  const usable = linkableProviders(currentSignInConfiguration(), { isAdministrator });
  return (
    <>
      <dl>
        <dt>{t("account.email")}</dt>
        <dd>{candidate.email}</dd>
      </dl>
      <SignInMethods
        linked={usable.filter((provider) => linkedIds.includes(provider.id))}
        linkable={usable.filter((provider) => !linkedIds.includes(provider.id))}
        failed={Boolean(error)}
      />
    </>
  );
}
