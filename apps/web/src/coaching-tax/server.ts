import { coachSpaceV2On } from "@/coach-space-v2/server";
import { sharedPool } from "@/database/pool";
import { getAuth, getMailer } from "@/auth/server";
import { getSecretResolver } from "@/provider-secrets/server";
import { secretCipherFromEnv } from "@/provider-secrets/cipher";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { coachingTaxes } from "./index";
import { taxLegalReady } from "./legal";
import { stripeTaxFacts, stripeTaxTransfers } from "./stripe";
import { validateFiscalXml } from "./schema";
import { fiscalCopyEmail } from "./email";
export function getCoachingTaxes() {
  const env = getSecretResolver().current().env;
  return coachingTaxes(sharedPool(), {
    cipher: secretCipherFromEnv(env),
    permitted: async () => taxLegalReady(),
    facts: env.STRIPE_SECRET_KEY
      ? stripeTaxFacts({ secretKey: env.STRIPE_SECRET_KEY, apiUrl: env.STRIPE_API_URL, externalApis: getExternalApiLog() })
      : undefined,
    platformFacts: env.STRIPE_SECRET_KEY
      ? stripeTaxTransfers({ secretKey: env.STRIPE_SECRET_KEY, apiUrl: env.STRIPE_API_URL, externalApis: getExternalApiLog() })
      : undefined,
    validateXml: validateFiscalXml,
    // « Espace coach v2 » off (ADR-0107): nothing sent to a Candidate or a Coach; the notice stays pending until it is on.
    ...(coachSpaceV2On()
      ? {
          sendCopy: async (notice: Parameters<typeof fiscalCopyEmail>[0] & { to: string }) => {
            await getMailer().send({ to: notice.to, ...fiscalCopyEmail(notice, String(getAuth().options.baseURL)) });
          },
        }
      : {}),
  });
}
