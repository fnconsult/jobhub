import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { notFound, redirect } from "next/navigation";
import { getAuth, getCurrentCandidate, getMailer, signInRedirect } from "@/auth/server";
import { getCoachContracts } from "@/coach-contracts/server";
import { sharedPool } from "@/database/pool";
import { coachAssociations } from "./index";
import { associationInvitationEmail } from "./email";
export function getCoachAssociations() {
    const secret = getAuth().options.secret;
    if (typeof secret !== "string")
        throw new Error("Auth secret required");
    return coachAssociations(sharedPool(), {
        secret,
        mayManage: async (person, id) => (await getCoachContracts().state(person, "association", id))?.accepted === true,
        // « Espace coach v2 » off (ADR-0106): nothing sent to a Candidate or a Coach; the notice stays pending until it is on.
        ...(coachSpaceV2On() ? {
            sendInvitation: async (record: Parameters<typeof associationInvitationEmail>[0], token: string) => {
                await getMailer().send({ to: record.email, ...associationInvitationEmail(record, token, String(getAuth().options.baseURL)) });
            },
        } : {}),
    });
}
export async function requireAssociation(id: string) {
    // An Association's space and its actions exist only with « Espace coach v2 » on (ADR-0106).
    requireCoachSpaceV2();
    const person = await getCurrentCandidate();
    if (!person)
        return signInRedirect();
    const associations = getCoachAssociations(), association = (await associations.managed(person)).find((a) => a.id === id);
    if (!association)
        notFound();
    if (!(await associations.authorized(person, id)))
        redirect("/espace-coach/contrat");
    return { person, association, associations };
}
/** Navigation identity only. Each destination checks contract acceptance and current membership again. */
export async function hasAssociationIdentity(person: import("./index").AssociationPerson) {
    return (await getCoachAssociations().managed(person)).length > 0;
}
export async function currentAssociationIdentity() {
    const person = await getCurrentCandidate();
    return person ? hasAssociationIdentity(person) : false;
}
