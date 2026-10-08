import { getHumanCoaches } from "@/human-coaches/server";
import { billingConfigFromEnv } from "./config";
import { createBilling, type Billing } from "./index";

let instance: Billing | undefined;

/** The app's billing module, configured from the environment on first use. Paid Coaching Sessions go to the Human Coaches module. */
export function getBilling(): Billing {
  instance ??= createBilling({ ...billingConfigFromEnv(process.env), onCoachingSessionPaid: (paid) => getHumanCoaches().recordPaidSession(paid) });
  return instance;
}
