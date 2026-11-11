import { getCoachingTaxes } from "@/coaching-tax/server";
import { getCoachContracts } from "@/coach-contracts/server";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { payoutRecipient, payoutInformationEmail } from "./email";
import { getAuth, getMailer } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getCoachingOffers } from "@/coaching-offers/server";
import { getOrders } from "@/orders/server";
import { getSecretResolver } from "@/provider-secrets/server";
import { sharedPool } from "@/database/pool";
import { coachingConnect } from "./index";
import { stripeConnect } from "./stripe";
import { connectLegalReady } from "./legal";
export function getConnectStripe() {
    const env = getSecretResolver().current().env;
    return env.STRIPE_SECRET_KEY && env.STRIPE_CONNECT_WEBHOOK_SECRET
        ? stripeConnect({
            secretKey: env.STRIPE_SECRET_KEY,
            webhookSecret: env.STRIPE_CONNECT_WEBHOOK_SECRET,
            apiUrl: env.STRIPE_API_URL,
            externalApis: getExternalApiLog(),
        })
        : undefined;
}
export function getCoachingConnect(): ReturnType<typeof coachingConnect> {
    return coachingConnect(sharedPool(), {
        stripe: getConnectStripe(),
        baseURL: String(getAuth().options.baseURL),
        permitted: async () => connectLegalReady(),
        maySell: async (seller) => {
            if (!await getCoachingTaxes().ready(seller.id))
                return false;
            const candidates = (await sharedPool().query<{
                email: string;
                emailVerified: boolean;
                subjectId: string;
                kind: "coach" | "association";
            }>(`SELECT c.email,c."emailVerified",CASE WHEN s.kind='human_coach' THEN s.coach_id ELSE s.association_id END AS "subjectId",CASE WHEN s.kind='human_coach' THEN 'coach' ELSE 'association' END AS kind FROM coaching_seller s LEFT JOIN coaching_connect_account k ON k.seller_id=s.id LEFT JOIN human_coach h ON h.id=s.coach_id JOIN candidate c ON c."emailVerified" AND ((s.kind='human_coach' AND ((k.owner_id=c.id) OR (k.seller_id IS NULL AND h.email=lower(c.email)))) OR (s.kind='association' AND EXISTS(SELECT 1 FROM coach_association_manager m WHERE m.association_id=s.association_id AND m.candidate_id=c.id))) WHERE s.id=$1`, [seller.id])).rows;
            for (const candidate of candidates)
                if ((await getCoachContracts().state(candidate, candidate.kind, candidate.subjectId))?.accepted)
                    return true;
            return false;
        },
        recordPaid: (paid, financials) => getHumanCoaches().recordPaidSession(paid, financials),
        attachSale: (paid, within) => getCoachingOffers().attachPaid(paid, within),
        confirmOrder: (paid) => getOrders().paid(paid),
        sendPayoutNotice: async (notice) => {
            const recipient = await payoutRecipient(sharedPool(), notice.sellerId);
            if (!recipient)
                return;
            await getMailer().send({ to: recipient.email, ...payoutInformationEmail(recipient, notice, String(getAuth().options.baseURL)) });
        },
    });
}
