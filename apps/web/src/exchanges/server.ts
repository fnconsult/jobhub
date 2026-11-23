import { sharedPool } from "@/database/pool";
import { secretCipherFromEnv, type SecretCipher } from "@/provider-secrets/cipher";
import { createExchanges, type Exchanges } from "./index";

export { exchangesOn } from "./on";

let instance: Exchanges | undefined;
let cipher: SecretCipher | null | undefined;

/**
 * The app's Exchanges (#1099, ADR-0115), on the database named by DATABASE_URL, sealed under SECRETS_MASTER_KEYS as Email
 * intake's texts are (the same keyring). Behind APPLICATION_EXCHANGES_ENABLED: see `exchangesOn`.
 */
export function getExchanges(): Exchanges {
  instance ??= createExchanges(sharedPool(), { cipher: () => (cipher ??= secretCipherFromEnv(process.env)) });
  return instance;
}
