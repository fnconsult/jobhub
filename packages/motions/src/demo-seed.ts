/**
 * The demo data the motions are filmed on (ADR-0066): a fictitious Candidate, never a real one, with one Profile and
 * three Applications, created through the app's own HTTP API on the throwaway database of the capture run. Every name,
 * employer and address here is invented.
 *
 *   await seedDemoCandidate(page.request, origin, "fr"); // once the demo Candidate is signed in
 */
import type { APIRequestContext } from "@playwright/test";
import type { HelpLocale } from "@jobhub/help";
import { applicationsResponseSchema, profilesResponseSchema } from "@jobhub/shared/reads";

/** The demo Candidate's address: a reserved test domain, which nobody receives mail at. */
export const DEMO_EMAIL = "claire.demo@motions.jobbbox.test";

export const DEMO_PROFILE = {
  masterCv: {
    fullName: "Claire Démo",
    headline: "Responsable comptable",
    email: "",
    phone: "",
    location: "Lyon",
    summary: "Comptable confirmée, dix ans en PME industrielle : clôtures, fiscalité, trésorerie.",
    experience: [],
    education: [],
    skills: ["Clôtures mensuelles", "Fiscalité", "Trésorerie", "SAP"],
    languages: [],
  },
  searchCriteria: { targetRole: "Responsable comptable", locations: ["Lyon"], contractTypes: ["cdi"] },
};

/** Job Offers of invented employers, at an invented address, each saved as an Application at its status. */
export const DEMO_APPLICATIONS = [
  { title: "Responsable comptable", employer: "Atelier Dumas", status: "to_apply" },
  { title: "Comptable unique", employer: "Brasserie des Monts", status: "applied" },
  { title: "Contrôleuse de gestion", employer: "Transports Ravel", status: "interview" },
] as const;

/** Creates the demo Profile and Applications for the signed-in demo Candidate, in the Interface Language `locale`. */
export async function seedDemoCandidate(request: APIRequestContext, origin: string, locale: HelpLocale): Promise<void> {
  const headers = { origin };
  const ok = async (response: Awaited<ReturnType<APIRequestContext["post"]>>, what: string) => {
    if (!response.ok()) throw new Error(`the demo seed could not ${what}: ${response.status()} ${await response.text()}`);
    return response;
  };
  await ok(await request.post("/api/auth/update-user", { headers, data: { interfaceLanguage: locale } }), "set the Interface Language");
  // Read through the app's own read contract (@jobhub/shared/reads): a change of shape breaks the seed loudly, rather than
  // leaving it a guard that never holds and re-saves the demo Applications on every run (#684).
  const profiles = profilesResponseSchema.parse(await (await ok(await request.get("/api/profiles"), "list the Profiles")).json());
  const profileId = profiles[0]?.id ?? ((await (await ok(await request.post("/api/profiles", { headers, data: DEMO_PROFILE }), "create the Profile")).json()) as { id: string }).id;
  const { applications } = applicationsResponseSchema.parse(await (await ok(await request.get("/api/applications"), "list the Applications")).json());
  if (applications.length > 0) return;
  for (const [index, application] of DEMO_APPLICATIONS.entries()) {
    const offer = await ok(
      await request.post("/api/job-offers", {
        headers,
        data: {
          source: { url: `https://offres.exemple.invalid/demo-${index + 1}` },
          title: application.title,
          content: `${application.employer} recrute : ${application.title}, en CDI, à Lyon. Offre de démonstration.`,
          employer: application.employer,
          location: "Lyon",
        },
      }),
      "create a Job Offer",
    );
    const saved = await ok(await request.post("/api/applications", { headers, data: { jobOfferId: ((await offer.json()) as { id: string }).id, profileId } }), "save an Application");
    if (application.status !== "to_apply") {
      const id = ((await saved.json()) as { id: string }).id;
      await ok(await request.patch(`/api/applications/${id}`, { headers, data: { status: application.status } }), "set an Application's status");
    }
  }
}
