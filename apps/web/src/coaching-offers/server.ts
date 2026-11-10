import { sharedPool } from "@/database/pool";
import { getBilling } from "@/billing/server";
import { coachingOffers } from "./index";
export const getCoachingOffers = () => coachingOffers(sharedPool(), { price: (id) => getBilling().coachingSessionPrice(id, true) });
