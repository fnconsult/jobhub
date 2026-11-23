import { sharedPool } from "@/database/pool";
import { createExchanges, type Exchanges } from "./index";

export { exchangesOn } from "./on";

let instance: Exchanges | undefined;

/** The app's Exchanges (#1099, ADR-0115), on the database named by DATABASE_URL. Behind APPLICATION_EXCHANGES_ENABLED: see `exchangesOn`. */
export function getExchanges(): Exchanges {
  instance ??= createExchanges(sharedPool());
  return instance;
}
