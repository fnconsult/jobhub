import { getCoachingConnect } from "@/coaching-connect/server";
import { sharedPool } from "@/database/pool";
import { getBilling } from "@/billing/server";
import { coachingOffers } from "./index";
export const getCoachingOffers = (): ReturnType<typeof coachingOffers> => coachingOffers(sharedPool(), { eligiblePlatformOffer: id => getCoachingConnect().eligiblePlatformOffer(id), eligibleSeller: id => getCoachingConnect().eligible(id), price: (id) => getBilling().coachingSessionPrice(id, true) });
