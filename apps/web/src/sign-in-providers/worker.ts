/** What the worker uses of the Sign-in Providers (`@jobhub/web/sign-in-providers`): Apple's client secret, signed again monthly. */
import type { Pool } from "pg";
import type { SecretCipher } from "../provider-secrets/cipher";
import { createSignInProviders, type SignInProviders } from "./index";

export { appleFailureEmail, type AppleFailureReason } from "./alerts";

type Env = Record<string, string | undefined>;

/** The worker's side: signing Apple's client secret again, nothing else. It makes no Back Office change. */
export function signInProvidersWorker(database: Pool, deps: { cipher: SecretCipher | null; env: Env; log?: (line: string) => void }): Pick<SignInProviders, "regenerateAppleClientSecrets"> {
  const providers = createSignInProviders(database, {
    ...deps,
    backOffice: {
      record: async () => {
        throw new Error("The worker makes no Back Office change");
      },
    },
  });
  return { regenerateAppleClientSecrets: () => providers.regenerateAppleClientSecrets() };
}
