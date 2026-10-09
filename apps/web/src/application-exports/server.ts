import { getApplications } from "@/applications/server";
import { getProfiles } from "@/profiles/server";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";
import { createApplicationExports, type ApplicationExports } from "./index";

let instance: ApplicationExports | undefined;

/** The app's Application exports, reading the app's Tailored CVs and Tailored Documents. */
export function getApplicationExports(): ApplicationExports {
  instance ??= createApplicationExports({
    applications: getApplications(),
    profiles: getProfiles(),
    tailoredCvs: getTailoredCvs(),
    tailoredDocuments: getTailoredDocuments(),
  });
  return instance;
}
