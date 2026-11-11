import {coachingNoticesOn} from "@/coaching-notifications/activation-server";
import { getCoachingCancellations, cancellationPolicyOn } from "@/coaching-cancellations/server";
import {getCoachPages} from "@/coach-pages/server";
import {getCoachContracts} from "@/coach-contracts/server";
import {coachSpaceV2On} from "@/coach-space/server";
import {redirect} from "next/navigation";
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
  instance ??= createHumanCoaches(sharedPool(), {
    contractualCancellationOn: cancellationPolicyOn,
    mayChangeSession: (within, id, by, to) => (by === "cal_com" ? Promise.resolve(true) : getCoachingCancellations().maySchedule(within, id, by, to)),
    coachingNotificationsOwned:coachingNoticesOn,
    publicProfileApprovalRequired: coachSpaceV2On,
    publishedCoachIds: async (ids) => (coachSpaceV2On()?(await getCoachPages().approved(ids)).map((p) => p.coachId) : ids),
    profiles: getProfiles(),
    applications: getApplications(),
    tailoredDocuments: getTailoredDocuments(),
    tailoredCvs: getTailoredCvs(),
    push: getPushNotifications(),
    mayEnter: (person,id) => (coachSpaceV2On() ? getCoachContracts().mayEnter(person,id) : Promise.resolve(true)),
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
  if (!person) return signInRedirect();
  const coach = await getHumanCoaches().coachSignedIn(person);
  if (!coach) {
    const approved=(await getCoachContracts().actors(person)).length>0;
    if(approved)redirect("/espace-coach/contrat");
    notFound();
  }
  return coach;
}

/** Navigation identity only: the destination still enforces contract acceptance before any Candidate access. */
export async function hasHumanCoachIdentity(person:{email:string;emailVerified:boolean}):Promise<boolean> {
  return coachSpaceV2On() ? (await getCoachContracts().actors(person)).some((actor) =>actor.kind==="coach") : (await getHumanCoaches().coachSignedIn(person))!==null;
}
export async function currentHasHumanCoachIdentity():Promise<boolean> {
  const person=await getCurrentCandidate();
  return person ? hasHumanCoachIdentity(person) : false;
}
