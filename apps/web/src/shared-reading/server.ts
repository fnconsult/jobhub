import { getDocumentProxy } from "unpdf";
import { sharedPool } from "@/database/pool";
import { getProfiles } from "@/profiles/server";
import { getApplications } from "@/applications/server";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";
import { sharedReading, type SharedSource } from "./index";
export const getSharedReading = () =>
  sharedReading(sharedPool(), {
    async document(candidateId, source) {
      if (source.kind === "profile") {
        const profile = await getProfiles().get(candidateId, source.id);
        return profile ? { kind: "cv", title: profile.name, content: profile.masterCv.content } : null;
      }
      const application = await getApplications().get(candidateId, source.id);
      if (!application) return null;
      if (source.kind === "tailored_cv") {
        const cv = await getTailoredCvs().get(candidateId, source.id);
        return cv?.saved ? { kind: "cv", title: application.jobOffer.title, content: cv.saved.content } : null;
      }
      const drafts = await getTailoredDocuments().get(candidateId, source.id);
      const text = source.kind === "cover_letter" ? drafts?.coverLetter?.text : drafts?.outreachMessage?.text;
      return text ? { kind: "text", title: application.jobOffer.title, text } : null;
    },
    async validatePdf(bytes) {
      try {
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const accepted = pdf.numPages > 0 && pdf.numPages <= 200;
        return accepted;
      } catch {
        return false;
      }
    },
  });
export async function candidateReadingSources(candidateId: string): Promise<{ source: SharedSource; title: string }[]> {
  const profiles = await getProfiles().list(candidateId);
  const applications = await getApplications().list(candidateId);
  const sources: { source: SharedSource; title: string }[] = profiles.map((profile) => ({ source: { kind: "profile", id: profile.id }, title: profile.name }));
  for (const application of applications) {
    const [cv, drafts] = await Promise.all([getTailoredCvs().get(candidateId, application.id), getTailoredDocuments().get(candidateId, application.id)]);
    for (const kind of ["tailored_cv", "cover_letter", "outreach_message"] as const) {
      if (kind === "tailored_cv" ? cv?.saved : kind === "cover_letter" ? drafts?.coverLetter : drafts?.outreachMessage)
        sources.push({ source: { kind, id: application.id }, title: application.jobOffer.title });
    }
  }
  return sources;
}
