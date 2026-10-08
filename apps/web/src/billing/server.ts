import { billingConfigFromEnv } from "./config";
import { createBilling, type Billing } from "./index";

let instance: Billing | undefined;

/** The app's billing module, configured from the environment on first use. */
export function getBilling(): Billing {
  instance ??= createBilling(billingConfigFromEnv(process.env));
  return instance;
}
