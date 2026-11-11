import { getAuth, getMailer } from "@/auth/server";
import { getPushNotifications } from "@/push-notifications/server";
import { cancellationNotice } from "./notice";
import { sharedPool } from "@/database/pool";
import { getCoachingRefunds } from "@/coaching-refunds/server";
import { getCoachingBooking } from "@/coaching-booking/server";
import { getCoachingOffers } from "@/coaching-offers/server";
import { getCoachPages } from "@/coach-pages/server";
import { coachingCancellations } from "./index";
import { cancellationLegalReady } from "./legal";
export async function cancellationPolicyOn() {
    return cancellationLegalReady();
}
export function getCoachingCancellations() {
    return coachingCancellations(sharedPool(), {
        refunds: getCoachingRefunds(),
        permitted: cancellationPolicyOn,
        sendNotice: (record, kind) => cancellationNotice(sharedPool(), record, kind, String(getAuth().options.baseURL), (email, message) => getMailer().send({ to: email, ...message }), getPushNotifications()),
        reopen: (id, within) => getCoachingBooking().reopen(id, within),
        async peers(candidateId, session, within) {
            // Lock current offer/Coach facts until the choice commits. A different Seller always requires a new explicit Order after the original refund.
            const candidates = (await within.query<{
                id: string;
                name: string;
            }>(`SELECT h.id,h.name FROM human_coach h JOIN coaching_offer o ON o.coach_id=h.id WHERE h.id<>$1 AND h.retired_at IS NULL AND h.public_ready AND NOT h.contract_pending ORDER BY h.id FOR SHARE OF h,o`, [session.coachId])).rows;
            const approved = await getCoachPages().approved(candidates.map((c) => c.id));
            const peers = [];
            for (const coach of candidates) {
                const page = approved.find((p) => p.coachId === coach.id);
                if (!page)
                    continue;
                const sale = await getCoachingOffers().sale(candidateId, coach.id);
                if (sale && sale.currency === session.currency && sale.amount <= session.amount)
                    peers.push({
                        coachId: coach.id,
                        name: coach.name,
                        amount: sale.amount,
                        currency: sale.currency,
                        durationMinutes: sale.durationMinutes,
                        specialties: page.page.specialties,
                        languages: page.page.languages,
                    });
            }
            return peers;
        },
    });
}
