/** Fictional public postings for the browser email flow. Unexpected requests never reach the network. */
import { cadremploiAlert } from "../../apps/web/src/email-intake/fixtures/offer-emails";
import { offerLink } from "../../apps/worker/src/email-intake/offer-links";

export const emailSourceFetch: typeof globalThis.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "www.cadremploi.fr" && url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
  const index = cadremploiAlert.reply.offers.findIndex((offer) => offerLink(offer.link!) === url.href);
  const offer = cadremploiAlert.reply.offers[index];
  if (!offer) throw new Error("Unexpected email source fixture request");
  const posting = {
    "@type": "JobPosting",
    title: offer.title,
    description: `PUBLIC_EMAIL_SOURCE: ${offer.title}. Responsabilités et conditions de cette annonce fictive.`,
    ...(offer.employer ? { hiringOrganization: { name: offer.employer } } : {}),
    jobLocation: { address: { addressLocality: offer.location } },
    employmentType: offer.contract,
    skills: index === 0 ? ["IFRS"] : ["Fixture specialist skill"],
    experienceRequirements: { monthsOfExperience: index === 0 ? 120 : 360 },
    baseSalary: { currency: "EUR", value: { minValue: 55_000, maxValue: 60_000, unitText: "YEAR" } },
    datePosted: new Date(Date.now() - 86_400_000).toISOString(),
  };
  return new Response(`<script type="application/ld+json">${JSON.stringify(posting)}</script>`, { headers: { "content-type": "text/html" } });
};
