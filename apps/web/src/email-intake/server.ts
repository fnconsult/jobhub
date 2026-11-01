import { getApplications } from "@/applications/server";
import { sharedPool } from "@/database/pool";
import { getJobOffers } from "@/job-offers/server";
import { getJobQueue } from "@/job-queue/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getProfiles } from "@/profiles/server";
import { secretCipherFromEnv, type SecretCipher } from "@/provider-secrets/cipher";
import { getSecretResolver } from "@/provider-secrets/server";
import { getSearchSites } from "@/search-sites/server";
import { emailIntakeDomain, emailIntakeLimits } from "./domain";
import { createEmailIntakeActivity, type EmailIntakeActivity } from "./activity";
import { createCandidateSenders, type CandidateSenders } from "./candidate-senders";
import { forwardingSetupOf, type ForwardingSetup } from "./forwarding-setup";
import { createEmailIntakeInbound, type EmailIntakeInbound } from "./inbound";
import { createEmailIntake, type EmailIntake } from "./index";
import { createReceivedOffers, type ReceivedOffers } from "./received-offers";
import { createRecognisedSenderList, type RecognisedSenderList } from "./recognised-sender-list";

let instance: EmailIntake | undefined;
let inbound: EmailIntakeInbound | undefined;
let cipher: SecretCipher | null | undefined;
let senders: RecognisedSenderList | undefined;
let received: ReceivedOffers | undefined;

/** What Email intake gave each Candidate (#447): the « Reçues par email » section and the Job Digest's Job Offers. */
export function getReceivedOffers(): ReceivedOffers {
  received ??= createReceivedOffers(sharedPool(), { jobOffers: getJobOffers(), profiles: getProfiles(), applications: getApplications() });
  return received;
}

/** The platform's Recognised senders and « Expéditeurs proposés » (#448), on the database named by DATABASE_URL. */
export function getRecognisedSenderList(): RecognisedSenderList {
  senders ??= createRecognisedSenderList(sharedPool());
  return senders;
}

let candidateSenders: CandidateSenders | undefined;

/** The Recognised senders each Candidate adds or switches off for themselves alone (#450). */
export function getCandidateSenders(): CandidateSenders {
  candidateSenders ??= createCandidateSenders(sharedPool());
  return candidateSenders;
}

/** The app's Email intake, on the database named by DATABASE_URL, giving addresses on the EMAIL_INTAKE_DOMAIN in use. */
export function getEmailIntake(): EmailIntake {
  instance ??= createEmailIntake(sharedPool(), { domain: () => emailIntakeDomain(getPlatformSettingsResolver().current()) });
  return instance;
}

/**
 * Email intake's door for the emails its MTA posts (#442, #580): the EMAIL_INTAKE_INBOUND_SECRET in use (Clés, else env), Email intake's
 * switch on the Sources tab (#448), its limits in use (Paramètres, else env), texts sealed under SECRETS_MASTER_KEYS, emails to read queued for the worker.
 */
export function getEmailIntakeInbound(): EmailIntakeInbound {
  inbound ??= createEmailIntakeInbound(sharedPool(), {
    emailIntake: getEmailIntake(),
    switchedOn: async () => (await getSearchSites().jobDiscoverySources()).email_intake,
    cipher: () => (cipher ??= secretCipherFromEnv(process.env)),
    queue: getJobQueue(),
    settings: () => {
      const { dailyCap, mtaIpRanges } = emailIntakeLimits(getPlatformSettingsResolver().current());
      return { secret: getSecretResolver().current().env.EMAIL_INTAKE_INBOUND_SECRET, mtaIpRanges, dailyCap };
    },
  });
  return inbound;
}

/** How far the Candidate's forwarding setup got (#451): Gmail's confirmation read with the texts' cipher, when there is one. */
export function getForwardingSetup(candidateId: string): Promise<ForwardingSetup | null> {
  return forwardingSetupOf(sharedPool(), (cipher ??= secretCipherFromEnv(process.env)), candidateId);
}

let activity: EmailIntakeActivity | undefined;

/** Email intake as the Back Office shows it (#449): Activité › Emails reçus and the Journal's Linked mailbox events, naming no Candidate. */
export function getEmailIntakeActivity(): EmailIntakeActivity {
  activity ??= createEmailIntakeActivity(sharedPool());
  return activity;
}
