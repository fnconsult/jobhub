// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for the careers site whose
// posting a Candidate pastes in the Coach Panel (e2e/coach-job-offer-link.spec.ts): its robots.txt
// lets everyone in, and its posting carries JobPosting JSON-LD, so no AI reads it. Every request to
// a site the web server reads a Job Offer link from, and to LinkedIn (a Forbidden site, never
// requested), is appended as one URL per line to coach-links.log beside E2E_SERVER_LOG. Nothing reaches the network.
import { appendFileSync } from "node:fs";
import path from "node:path";

const SITE = "https://carrieres.coach-links.e2e-jobbbox.fr";
const logFile = process.env.E2E_SERVER_LOG ? path.join(path.dirname(process.env.E2E_SERVER_LOG), "coach-links.log") : null;
const realFetch = globalThis.fetch;

const posting = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Directrice administrative et financière H/F",
  description: "<p>Fromagerie Lyonnaise recrute sa directrice administrative et financière : clôtures, trésorerie, relation avec les banques.</p>",
  hiringOrganization: { "@type": "Organization", name: "Fromagerie Lyonnaise" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Lyon" } },
  employmentType: "FULL_TIME",
};

const html = (body) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(SITE) && !/^https:\/\/([a-z]+\.)?linkedin\.com\//.test(url)) return realFetch(input, init);
  if (logFile) appendFileSync(logFile, `${url}\n`);
  const { pathname } = new URL(url);
  if (pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
  if (pathname === "/offres/daf-lyon")
    return html(`<html><head><title>DAF H/F</title><script type="application/ld+json">${JSON.stringify(posting)}</script></head><body><h1>${posting.title}</h1>${posting.description}</body></html>`);
  if (pathname === "/offres") return html(`<html><head><title>Nos offres</title></head><body><h1>Nos offres</h1><p>Aucune offre en ce moment.</p></body></html>`);
  return new Response("introuvable", { status: 404 });
};
