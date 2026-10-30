import { currentIsAdministrator } from "@/admin/server";
import { getCurrentCandidate, linkedSignInProviders, signInRedirect } from "@/auth/server";
import { SignInMethods } from "@/components/SignInMethods";
import { Card } from "@/design/Card";
import { Properties, Property } from "@/design/Properties";
import { getServerT } from "@/i18n/server";
import { linkableProviders } from "@/sign-in-providers/policy";
import { currentSignInConfiguration } from "@/sign-in-providers/server";

/** Mon compte's Sign-in Section: the account's email address and its sign-in methods. */
export default async function AccountSignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [t, isAdministrator, linkedIds, { error }] = await Promise.all([getServerT(), currentIsAdministrator(), linkedSignInProviders(), searchParams]);
  const usable = linkableProviders(currentSignInConfiguration(), { isAdministrator });
  return (
    <>
      <Card>
        <Properties>
          <Property term={t("account.email")}>{candidate.email}</Property>
        </Properties>
      </Card>
      <SignInMethods
        linked={usable.filter((provider) => linkedIds.includes(provider.id))}
        linkable={usable.filter((provider) => !linkedIds.includes(provider.id))}
        failed={Boolean(error)}
      />
    </>
  );
}
