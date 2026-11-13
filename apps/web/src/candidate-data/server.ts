import {secretCipherFromEnv} from "@/provider-secrets/cipher";
import {getSecretResolver} from "@/provider-secrets/server";
import { cancellationPolicyOn } from "@/coaching-cancellations/server";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { sharedPool } from "@/database/pool";
import { getApplications } from "@/applications/server";
import { getBilling } from "@/billing/server";
import { getProfiles } from "@/profiles/server";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";
import { createCandidateData, type CandidateData } from "./index";

let instance: CandidateData | undefined;

/** The app's Candidate data module (export and account deletion), on the database named by DATABASE_URL. */
export function getCandidateData(): CandidateData {
  instance ??= createCandidateData(sharedPool(), {
    fiscalCipher:()=>secretCipherFromEnv(getSecretResolver().current().env),
    profiles: getProfiles(),
    applications: getApplications(),
    tailoredCvs: getTailoredCvs(),
    tailoredDocuments: getTailoredDocuments(),
    billing: getBilling(),
    coachingCancellationOn: cancellationPolicyOn,
    coachSpaceV2: coachSpaceV2On,
  });
  return instance;
}
