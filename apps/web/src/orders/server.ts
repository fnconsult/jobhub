import { getCoachingCancellations } from "@/coaching-cancellations/server";
import {getCoachingOffers} from "@/coaching-offers/server";
import { getAcceptances } from "@/acceptances/server";
import { getAuth, getMailer } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { sharedPool } from "@/database/pool";
import { getHumanCoaches } from "@/human-coaches/server";
import { createOrders, type Orders } from "./index";

let instance: Orders | undefined;

/** The app's Orders (#512), on the database named by DATABASE_URL: Checkout through billing, the Order Confirmation through the app's mailer (Brevo). */
export function getOrders(): Orders {
  instance ??= createOrders(sharedPool(), {
    billing: getBilling(),
    offers:getCoachingOffers(),
    peerOrderCap: (candidate, id, coach) => getCoachingCancellations().peerOrderCap(candidate, id, coach),
    coaches: getHumanCoaches(),
    acceptances: getAcceptances(),
    mailer: getMailer(),
    baseURL: String(getAuth().options.baseURL),
  });
  return instance;
}
