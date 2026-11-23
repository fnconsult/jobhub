/**
 * How an email reaching the Candidate's Linked mailbox is tied to one of their Applications (#1099, ADR-0115): by rules,
 * never by AI. A rule ties it only when it points at one Application; pointing at several, or by a weak match, it is
 * offered to the Candidate (« Rattacher à Benchling ? »), tied on their gesture only. Matching nothing, the email keeps
 * today's path (« autre », its text not kept).
 *
 *   matchExchange({ from, threadIds, recognisedSender }, leads)
 *   // { kind: "tie", applicationId } | { kind: "offer", applicationIds } | { kind: "none" }
 *
 * The rules, strongest first:
 *  1. the thread of an Exchange already kept: its In-Reply-To or References name one an Application keeps;
 *  2. one of the Application's Enriched Contacts sent it (their revealed address);
 *  3. the employer's domain: the sender's domain is its website's (its Company Dossier's), or its name is the employer's
 *     (benchling.com for « Benchling »); a free mailbox's domain or a Recognised sender's (a job board's alerts) never is;
 *  4. weak: the sender's domain holds the employer's name, or the reverse (renault-careers.fr for « Groupe Renault »).
 */

/** What the rules know of one of the Candidate's Applications. */
export interface ApplicationLead {
  id: string;
  /** The employer its Job Offer names, if any. */
  employer: string | null;
  /** The employer's website, as its Company Dossier gives it, if any. */
  website: string | null;
  /** Its Enriched Contacts' revealed addresses. */
  contactEmails: readonly string[];
  /** The Message-IDs of the Exchanges it keeps. */
  messageIds: readonly string[];
}

/** What the rules read of an email: its sender, the Message-IDs its thread names, and whether its sender is a Recognised sender. */
export interface EmailToMatch {
  from: string;
  /** Its In-Reply-To and References, read to match only, never kept. */
  threadIds: readonly string[];
  recognisedSender: boolean;
}

export type ExchangeMatch = { kind: "tie"; applicationId: string } | { kind: "offer"; applicationIds: string[] } | { kind: "none" };

/** Mailboxes anyone has: their domain says nothing of an employer. */
const FREE_MAILBOXES = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.fr",
  "hotmail.com",
  "hotmail.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "aol.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "gmx.com",
  "gmx.fr",
  "proton.me",
  "protonmail.com",
]);

/** The second-level suffixes under which an organisation's domain has three labels (example.co.uk). */
const SECOND_LEVEL = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "co.jp", "com.br", "co.nz", "co.za", "com.mx", "co.in", "gouv.fr", "com.tr", "com.cn"]);

/** Words of a company's name that say nothing of which company it is. */
const GENERIC_WORDS = new Set(["sa", "sas", "sasu", "sarl", "eurl", "sca", "inc", "ltd", "llc", "llp", "gmbh", "ag", "plc", "bv", "nv", "spa", "srl", "se", "corp", "corporation", "company", "co", "group", "groupe", "the", "et", "and", "cie"]);

/** Below this length, a name is too short to be found inside a domain (« BNP » in bnpparibas.com could be anyone's). */
const MIN_CONTAINED = 4;

const folded = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** An employer's name as a domain would spell it: « Groupe Renault SA » → « renault ». Empty when nothing is left. */
function slugOf(employer: string | null): string {
  if (!employer) return "";
  return folded(employer)
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !GENERIC_WORDS.has(word))
    .join("");
}

const domainOf = (address: string) => address.trim().toLowerCase().slice(address.lastIndexOf("@") + 1);

/** A host's organisation domain: mail.benchling.com → benchling.com, jobs.example.co.uk → example.co.uk. */
function organisationOf(host: string): string {
  const labels = host.replace(/^www\./, "").split(".").filter(Boolean);
  const two = labels.slice(-2).join(".");
  return SECOND_LEVEL.has(two) ? labels.slice(-3).join(".") : two;
}

/** A website's host, or null for one that does not read. */
function hostOf(website: string | null): string | null {
  if (!website) return null;
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  return URL.canParse(url) ? new URL(url).hostname.toLowerCase() : null;
}

/** `ids` as a match: one ties, several are offered, none is no match. */
function matchOf(ids: readonly string[]): ExchangeMatch | null {
  const unique = [...new Set(ids)];
  if (unique.length === 1) return { kind: "tie", applicationId: unique[0]! };
  if (unique.length > 1) return { kind: "offer", applicationIds: unique };
  return null;
}

export function matchExchange(email: EmailToMatch, leads: readonly ApplicationLead[]): ExchangeMatch {
  const from = email.from.trim().toLowerCase();
  const thread = new Set(email.threadIds.map((id) => id.trim()));
  const inThread = leads.filter((lead) => lead.messageIds.some((id) => thread.has(id)));
  const byThread = matchOf(inThread.map((lead) => lead.id));
  if (byThread) return byThread;

  const byContact = matchOf(leads.filter((lead) => lead.contactEmails.some((address) => address.trim().toLowerCase() === from)).map((lead) => lead.id));
  if (byContact) return byContact;

  const domain = domainOf(from);
  const organisation = organisationOf(domain);
  if (email.recognisedSender || FREE_MAILBOXES.has(organisation)) return { kind: "none" };
  const label = organisation.split(".")[0]!.replace(/[^a-z0-9]/g, "");

  const strong = leads.filter((lead) => {
    const website = hostOf(lead.website);
    if (website && organisationOf(website) === organisation) return true;
    const slug = slugOf(lead.employer);
    return slug.length > 1 && slug === label;
  });
  const byDomain = matchOf(strong.map((lead) => lead.id));
  if (byDomain) return byDomain;

  const weak = leads.filter((lead) => {
    const slug = slugOf(lead.employer);
    return slug.length >= MIN_CONTAINED && label.length >= MIN_CONTAINED && (label.includes(slug) || slug.includes(label));
  });
  return weak.length > 0 ? { kind: "offer", applicationIds: [...new Set(weak.map((lead) => lead.id))] } : { kind: "none" };
}
