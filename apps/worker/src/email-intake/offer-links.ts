/**
 * The offer's own link, from the link an offer email gives for it (#445, ADR-0052): the AI reads the email's offers,
 * and copies each one's link as the email writes it; a small module per Recognised sender only takes the offer's id
 * out of that link and strips its tracking. No field is read here: no template of any email.
 *
 *   offerLink("https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=…") // "https://www.linkedin.com/jobs/view/4012345678/"
 *   offerLink("mailto:…")                                                          // null
 *
 * A click-tracking redirect carrying the offer's address in a parameter is opened first (a few levels at most). A
 * site with no module of its own keeps its link, the usual tracking parameters dropped.
 */
import { isOnDomain } from "@jobhub/shared";

/** One sender's module: the offer's link from a link to it on that sender's site, or null when it names no offer. */
interface SenderLinks {
  domain: string;
  offerUrl(url: URL): string | null;
}

/** Parameters that track a click, never which offer it is. */
const TRACKING = /^(utm_.*|at_.*|xtor|trk|trkInfo|trackingId|refId|lipi|midToken|midSig|eid|otpToken|mc_[a-z]+|fbclid|gclid|msclkid|ref|src|source|from|origin|campaign|medium)$/i;

/** Parameters a click-tracking redirect carries the destination in. */
const REDIRECT_PARAMETERS = ["url", "u", "redirect", "redirect_url", "redirectUrl", "target", "dest", "destination", "link", "to"];

/** How many redirects are opened before giving up. */
const MAX_REDIRECTS = 3;

/** The link with only the parameters `keep` names, in their order. */
function keeping(url: URL, keep: (name: string) => boolean): string {
  const params = [...url.searchParams].filter(([name]) => keep(name));
  const query = new URLSearchParams(params).toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

/** The offer is its path: every parameter goes. */
const pathOnly = (url: URL) => `${url.origin}${url.pathname}`;

/** The modules of the Recognised senders whose links need more than their tracking dropped. */
const SENDERS: readonly SenderLinks[] = [
  {
    // An alert's link goes through /comm/; the offer's page is /jobs/view/<id>/.
    domain: "linkedin.com",
    offerUrl: (url) => {
      const id = /\/jobs\/view\/(\d+)/.exec(url.pathname)?.[1];
      return id ? `https://www.linkedin.com/jobs/view/${id}/` : null;
    },
  },
  {
    // Whatever its path (rc/clk, pagead, a tracking host), the offer is its `jk`.
    domain: "indeed.com",
    offerUrl: (url) => {
      const jk = url.searchParams.get("jk") ?? url.searchParams.get("vjk");
      return jk && /^[0-9a-f]{8,32}$/i.test(jk) ? `https://fr.indeed.com/viewjob?jk=${jk}` : null;
    },
  },
  { domain: "cadremploi.fr", offerUrl: (url) => keeping(url, (name) => name === "offreId") },
  { domain: "hellowork.com", offerUrl: pathOnly },
  { domain: "welcometothejungle.com", offerUrl: pathOnly },
  { domain: "apec.fr", offerUrl: pathOnly },
  { domain: "francetravail.fr", offerUrl: pathOnly },
  { domain: "jobijoba.com", offerUrl: pathOnly },
];

const parse = (link: string): URL | null => {
  const text = link.trim();
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  return url.protocol === "https:" || url.protocol === "http:" ? url : null;
};

/** The address a click-tracking redirect leads to, when one of its parameters holds one. */
function redirectOf(url: URL): URL | null {
  for (const name of REDIRECT_PARAMETERS) {
    const value = url.searchParams.get(name);
    const target = value ? parse(value) : null;
    if (target) return target;
  }
  return null;
}

/** The offer's link, its id kept and its tracking dropped; null for what is no web link. */
export function offerLink(link: string): string | null {
  let url = parse(link);
  if (!url) return null;
  for (let opened = 0; opened < MAX_REDIRECTS; opened++) {
    const target = redirectOf(url);
    if (!target) break;
    url = target;
  }
  url.hash = "";
  const sender = SENDERS.find((each) => isOnDomain(url.hostname, each.domain));
  if (sender) return sender.offerUrl(url);
  return keeping(url, (name) => !TRACKING.test(name));
}
