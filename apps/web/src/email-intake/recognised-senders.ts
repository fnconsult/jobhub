/**
 * Whose emails Email intake reads (CONTEXT.md: Recognised sender, Received offer email; #437): a Recognised sender
 * of the platform's list, a manual forward from one of the Candidate's own sending addresses, or Gmail's forwarding
 * confirmation (kept for the setup wizard). Anything else is set aside unread, « expéditeur non reconnu ».
 *
 *   senderStanding(email, { recognisedSenders, sendingAddresses }) // "recognised_sender" | "own_address" | ...
 *
 * A sender counts only once authenticated, as Email intake's MTA found it (the Authentication-Results it wrote):
 * DMARC passed for the From domain; or, for a Recognised sender listed `aligned` (diffusion.apec.fr) and for the
 * Candidate's own addresses, DKIM or SPF passed for a domain of the same organisation. A From address alone is
 * written by whoever sends the email. The organisation of a domain is its last two labels: enough for the senders
 * of France's job market (.fr, .com), not for a suffix such as .co.uk.
 */
import type { InboundEmail } from "./inbound-email";

/** A sender of offer emails whose emails Email intake reads: by its domain (and those under it), or by its full address on a shared sending platform. */
export interface RecognisedSender {
  match: "domain" | "address";
  /** In lower case: `cadremploi.fr`, or `x-jobnotification@noreply12.jobs2web.com`. */
  value: string;
  /** « plateforme ou entreprise – site », for display only. */
  label: string;
  /** Also recognised by aligned SPF or DKIM, for a sender whose domain publishes no DMARC policy. */
  aligned?: boolean;
}

/** The platform's list at first: the senders of the corpus of #433. Administrators keep it from then on. */
export const SEEDED_RECOGNISED_SENDERS: readonly RecognisedSender[] = [
  { match: "domain", value: "linkedin.com", label: "LinkedIn – linkedin.com" },
  { match: "domain", value: "indeed.com", label: "Indeed – indeed.com" },
  { match: "domain", value: "cadremploi.fr", label: "Cadremploi – cadremploi.fr" },
  { match: "domain", value: "hellowork.com", label: "HelloWork – hellowork.com" },
  { match: "domain", value: "welcometothejungle.com", label: "Welcome to the Jungle – welcometothejungle.com" },
  { match: "domain", value: "jobijoba.com", label: "Jobijoba – jobijoba.com" },
  { match: "domain", value: "free-work.com", label: "Free-Work – free-work.com" },
  { match: "domain", value: "experteer.com", label: "Experteer – experteer.com" },
  { match: "domain", value: "francetravail.fr", label: "France Travail – francetravail.fr" },
  { match: "domain", value: "diffusion.apec.fr", label: "APEC – apec.fr", aligned: true },
  { match: "address", value: "capgemitecp3-jobnotification@noreply12.jobs2web.com", label: "Capgemini – careers.capgemini.com" },
  { match: "address", value: "canal+group-jobnotification@noreply2.jobs2web.com", label: "Canal+ – joinus.canalplus.com" },
];

/**
 * Shared sending platforms (#437): domains that send for many job boards and companies, so a sender on one is
 * recognised by its full address, never by the domain. Client-safe.
 */
export const SHARED_SENDING_PLATFORMS: readonly string[] = ["jobs2web.com", "mjt.lu", "sendgrid.net"];

/** Whether `domain` (in lower case) is a shared sending platform's, or under one. */
export function isSharedSendingPlatform(domain: string): boolean {
  return SHARED_SENDING_PLATFORMS.some((platform) => domain === platform || domain.endsWith(`.${platform}`));
}

/** Gmail's forwarding confirmation: read, so the setup wizard can show its code. */
export const GMAIL_FORWARDING_CONFIRMATION = "forwarding-noreply@google.com";

/** Why an email is read, or that it is not. */
export type SenderStanding = "recognised_sender" | "own_address" | "forwarding_confirmation" | "unrecognised";

/** One method's result in an Authentication-Results header, with its properties (`header.from`, `smtp.mailfrom`...). */
interface MethodResult {
  method: string;
  result: string;
  properties: Record<string, string>;
}

function methodResults(header: string): MethodResult[] {
  // The first part is the authserv-id of the MX that wrote it.
  return header
    .split(";")
    .slice(1)
    .flatMap((part) => {
      const words = part.replace(/\([^)]*\)/g, " ").trim().split(/\s+/);
      const [method, result] = (words[0] ?? "").toLowerCase().split("=");
      if (!method || !result) return [];
      const properties: Record<string, string> = {};
      for (const word of words.slice(1)) {
        const [name, ...value] = word.split("=");
        if (name && value.length > 0) properties[name.toLowerCase()] = value.join("=").toLowerCase();
      }
      return [{ method, result, properties }];
    });
}

const domainOf = (address: string): string => address.slice(address.lastIndexOf("@") + 1);
const organisationOf = (domain: string): string => domain.split(".").slice(-2).join(".");

/** How the MTA authenticated the From domain: DMARC passed for it, or (weaker) DKIM or SPF passed for its organisation. */
function authenticationOf(from: string, authenticationResults: string): { dmarc: boolean; aligned: boolean } {
  const domain = domainOf(from);
  const results = methodResults(authenticationResults).filter((entry) => entry.result === "pass");
  const dmarc = results.some((entry) => entry.method === "dmarc" && entry.properties["header.from"] === domain);
  const authenticated = results.flatMap((entry) => {
    if (entry.method === "dkim") return [entry.properties["header.d"] ?? domainOf(entry.properties["header.i"] ?? "")];
    if (entry.method === "spf") return [domainOf(entry.properties["smtp.mailfrom"] ?? "")];
    return [];
  });
  return { dmarc, aligned: dmarc || authenticated.some((other) => other !== "" && organisationOf(other) === organisationOf(domain)) };
}

function listed(sender: RecognisedSender, from: string): boolean {
  if (sender.match === "address") return from === sender.value;
  const domain = domainOf(from);
  return domain === sender.value || domain.endsWith(`.${sender.value}`);
}

/** Whether Email intake reads an email, and why: by its sender and how the MTA authenticated it. */
export function senderStanding(
  email: Pick<InboundEmail, "from" | "authenticationResults">,
  known: { recognisedSenders: readonly RecognisedSender[]; sendingAddresses: readonly string[] },
): SenderStanding {
  const from = email.from.trim().toLowerCase();
  const { dmarc, aligned } = authenticationOf(from, email.authenticationResults);
  if (from === GMAIL_FORWARDING_CONFIRMATION && dmarc) return "forwarding_confirmation";
  if (known.sendingAddresses.includes(from) && aligned) return "own_address";
  if (known.recognisedSenders.some((sender) => listed(sender, from) && (dmarc || (sender.aligned === true && aligned)))) return "recognised_sender";
  return "unrecognised";
}
