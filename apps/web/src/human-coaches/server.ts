import { coachingNoticesOn } from "@/coaching-notifications/activation-server";
import { getCoachingCancellations, cancellationPolicyOn } from "@/coaching-cancellations/server";
import { getCoachPages } from "@/coach-pages/server";
import { getCoachContracts } from "@/coach-contracts/server";
import { redirect } from "next/navigation";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { notFound } from "next/navigation";
import { sharedPool } from "@/database/pool";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getProfiles } from "@/profiles/server";
import { getPushNotifications } from "@/push-notifications/server";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";
import { createHumanCoaches, type HumanCoach, type HumanCoaches } from "./index";
let instance: HumanCoaches | undefined;
/** The app's Human Coaches module, on the database named by DATABASE_URL. */
export function getHumanCoaches(): HumanCoaches {
    // « Espace coach v2 » off (ADR-0107): no contract, no cancellation policy, no Coaching notices, every coach listed.
    instance ??= createHumanCoaches(sharedPool(), {
        coachSpaceV2On,
        contractualCancellationOn: async () => coachSpaceV2On() && (await cancellationPolicyOn()),
        mayChangeSession: (within, id, by, to) => (by === "cal_com" || !coachSpaceV2On() ? Promise.resolve(true) : getCoachingCancellations().maySchedule(within, id, by, to)),
        coachingNotificationsOwned: () => coachSpaceV2On() && coachingNoticesOn(),
        publicProfileApprovalRequired: () => true,
        publishedCoachIds: async (ids) => ((await getCoachPages().approved(ids)).map((p) => p.coachId)),
        profiles: getProfiles(),
        applications: getApplications(),
        tailoredDocuments: getTailoredDocuments(),
        tailoredCvs: getTailoredCvs(),
        push: getPushNotifications(),
        mayEnter: (person, id) => (coachSpaceV2On() ? getCoachContracts().mayEnter(person, id) : Promise.resolve(true)),
    });
    return instance;
}
/** The Human Coach signed in on this request, or null. */
export async function currentHumanCoach(): Promise<HumanCoach | null> {
    const person = await getCurrentCandidate();
    return person ? getHumanCoaches().coachSignedIn(person) : null;
}
/**
 * The Human Coach signed in on this request, for the coach space. Sends
 * anonymous visitors to sign in, and answers 404 to everyone else.
 */
export async function requireHumanCoach(): Promise<HumanCoach> {
    const person = await getCurrentCandidate();
    if (!person)
        return signInRedirect();
    const coach = await getHumanCoaches().coachSignedIn(person);
    if (!coach) {
        if (!coachSpaceV2On())
            notFound();
        const approved = (await getCoachContracts().actors(person)).length > 0;
        if (approved)
            redirect("/espace-coach/contrat");
        notFound();
    }
    return coach;
}
/** Navigation identity only (« Espace coach v2 » on): the destination still enforces contract acceptance before any Candidate access. */
export async function hasHumanCoachIdentity(person: {
    email: string;
    emailVerified: boolean;
}): Promise<boolean> {
    // Off, as before the epic: only an active Human Coach, signed in, sees « Espace coach ».
    if (!coachSpaceV2On())
        return (await getHumanCoaches().coachSignedIn(person)) !== null;
    return (await getCoachContracts().actors(person)).some((actor) => actor.kind === "coach");
}
export async function currentHasHumanCoachIdentity(): Promise<boolean> {
    const person = await getCurrentCandidate();
    return person ? hasHumanCoachIdentity(person) : false;
}
