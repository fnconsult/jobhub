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

/**
 * The demo Candidate of one capture (#570): one per script and language, so each video starts from the same demo data,
 * whatever another capture of the run changed (a status set, email intake switched on).
 */
export function demoEmail(id: string, locale: HelpLocale): string {
  return `claire.demo.${id}.${locale}@motions.jobbbox.test`;
}

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

/**
 * The demo Candidate's CV, as the lines of the PDF a video drops in (`upload … "cv-claire-demo.pdf"`, #570): the same
 * invented person, at a reserved test address. The capture stage writes the PDF (e2e/motions.spec.ts).
 */
export const DEMO_CV_LINES = [
  "Claire Démo",
  "Responsable comptable",
  "claire.demo@exemple.invalid",
  "Lyon",
  "Profil",
  "Comptable confirmée, dix ans en PME industrielle : clôtures, fiscalité, trésorerie.",
  "Expérience professionnelle",
  "Comptable principale — Fonderies Imaginaires, Lyon — 2016 – 2026",
  "Clôtures mensuelles et annuelles, déclarations fiscales, trésorerie.",
  "Formation",
  "DCG — 2015",
  "Compétences",
  "Clôtures mensuelles, Fiscalité, Trésorerie, SAP, Excel",
];

/**
 * The Human Coach a Candidate books in the session video (#570): invented, added by the run's Administrator. Their
 * Cal.com page is never opened in the video.
 */
export const DEMO_COACH = {
  name: "Sophie Démo",
  email: "sophie.demo@motions.jobbbox.test",
  bookingUrl: "https://cal.com/sophie-demo/seance",
  bio: "Ancienne responsable du recrutement dans l'industrie. Coach de démonstration.",
};

/** The Administrator who adds the demo Human Coach: one of the e2e server's ADMIN_EMAILS (playwright.config.ts). */
export const DEMO_ADMINISTRATOR = "motions-office@e2e.jobbbox.test";

/**
 * The invented job offer a Guest's video analyses with the extension (#570), on a job board the extension knows, served
 * by the capture itself (nothing is fetched from that site): its schema.org JobPosting is what the extension reads.
 */
export const DEMO_JOB_OFFER = {
  url: "https://www.welcometothejungle.com/fr/companies/maison-verlaine-demo/jobs/responsable-comptable-lyon",
  title: "Responsable comptable H/F",
  employer: "Maison Verlaine (démo)",
};

const posting = {
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  title: DEMO_JOB_OFFER.title,
  description:
    "<p>Maison Verlaine, fabricant de meubles imaginaire, recrute sa ou son responsable comptable.</p><p>Vous menez les clôtures mensuelles, les déclarations fiscales et la trésorerie. Cinq ans d'expérience au moins ; SAP et Power BI sont un plus.</p>",
  datePosted: "2026-10-28",
  employmentType: "FULL_TIME",
  hiringOrganization: { "@type": "Organization", name: DEMO_JOB_OFFER.employer },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Lyon" } },
  skills: "Clôtures mensuelles, Fiscalité, Trésorerie, SAP, Power BI",
};

/** The offer's page: plain, unbranded, with « Offre de démonstration » in view. */
export const DEMO_JOB_OFFER_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${DEMO_JOB_OFFER.title} – ${DEMO_JOB_OFFER.employer}</title>
<script type="application/ld+json">${JSON.stringify(posting)}</script>
<style>
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #1f2937; background: #f9fafb; }
  header { padding: 16px 40px; background: #fff; border-bottom: 1px solid #e5e7eb; font-weight: 600; }
  main { max-width: 760px; margin: 32px 40px; padding: 32px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; }
  h1 { margin: 0 0 8px; font-size: 28px; }
  .meta { color: #4b5563; margin: 0 0 24px; }
  .demo { display: inline-block; margin-bottom: 16px; padding: 2px 10px; border-radius: 999px; background: #fef3c7; font-size: 14px; }
</style></head>
<body><header>Site d'offres d'emploi</header>
<main><span class="demo">Offre de démonstration</span><h1>${DEMO_JOB_OFFER.title}</h1>
<p class="meta">${DEMO_JOB_OFFER.employer} · Lyon · CDI</p>
${posting.description}
<h2>Compétences</h2><p>${posting.skills}</p></main></body></html>`;
