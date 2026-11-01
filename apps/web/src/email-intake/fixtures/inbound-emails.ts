/**
 * Fictional emails as Email intake's MTA posts them (#580), written on the model of the corpus of #433 (kept outside
 * the repo): the senders and authentication a real alert shows, invented offers and people. Never a real email.
 *
 *   inboundRequest(alertEmail(address), SECRET)   one email, as the MTA posts it: raw MIME and its envelope
 *   mimeOf(email)                                 its raw message (RFC 5322) alone
 */
import { AUTHENTICATION_RESULTS_HEADER, ENVELOPE_TO_HEADER, INBOUND_SECRET_HEADER, RAW_MESSAGE_TYPE } from "../inbound-headers";

/** One email received by the MTA: its envelope, the stamp the MTA wrote, and what its message holds. */
export interface InboundTestEmail {
  messageId: string;
  from: string;
  fromName: string | null;
  /** The envelope's recipient (RCPT TO): the Forwarding address it was delivered to. */
  to: string;
  /** The message's To header; a forward keeps the Candidate's own address there. Default `to`. */
  headerTo: string;
  sentAt: string;
  subject: string;
  html: string | null;
  text: string | null;
  /**
   * The Authentication-Results: the first is the MTA's own stamp (sent beside the message), any other one a header
   * the message itself carried, which anyone can write.
   */
  authentication: string[];
}

let sequence = 0;

/** The MTA's stamp: its Authentication-Results, the one Email intake trusts. */
export function authenticationResults(domain: string, results: { dmarc?: "pass" | "fail" | "none"; dkim?: string | null; spf?: string | null } = {}): string {
  const { dmarc = "pass", dkim = domain, spf = null } = results;
  return [
    "mx.jobbbox.test",
    dkim ? `dkim=pass header.d=${dkim} header.s=s1` : "dkim=none",
    spf ? `spf=pass smtp.mailfrom=bounces@${spf}` : "spf=softfail smtp.mailfrom=forwarder@gmail.com",
    `dmarc=${dmarc} header.from=${domain}`,
  ].join("; ");
}

/** An email the MTA received, from `from` to `to`; the rest defaults to an offer alert's shape. */
export function inboundEmail(options: {
  from: string;
  to: string;
  headerTo?: string;
  authentication?: string | string[];
  html?: string | null;
  text?: string | null;
  subject?: string;
  messageId?: string;
  sentAt?: string;
}): InboundTestEmail {
  sequence += 1;
  const authentication = options.authentication ?? authenticationResults(options.from.split("@")[1]!);
  return {
    messageId: options.messageId ?? `<fixture-${sequence}@mail.example.test>`,
    from: options.from,
    fromName: "Alertes emploi",
    to: options.to,
    headerTo: options.headerTo ?? options.to,
    sentAt: options.sentAt ?? "Mon, 26 Oct 2026 22:18:15 +0000",
    subject: options.subject ?? "3 nouvelles offres pour « Chef de projet digital »",
    html: options.html === undefined ? null : options.html,
    text: options.text === undefined ? null : options.text,
    authentication: Array.isArray(authentication) ? authentication : [authentication],
  };
}

const base64Lines = (value: string) => (Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g) ?? [""]).join("\r\n");
const encodedWord = (value: string) => `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

function textPart(type: "plain" | "html", content: string): string[] {
  return [`Content-Type: text/${type}; charset=utf-8`, "Content-Transfer-Encoding: base64", "", base64Lines(content)];
}

/** The raw message: its headers (an image attached, a mailer named: what Email intake must never keep), its parts in base64. */
export function mimeOf(email: InboundTestEmail): string {
  const parts: string[][] = [];
  if (email.text !== null) parts.push(textPart("plain", email.text));
  if (email.html !== null) parts.push(textPart("html", email.html));
  const alternative = ["Content-Type: multipart/alternative; boundary=\"alt-boundary\"", "", ...parts.flatMap((part) => ["--alt-boundary", ...part]), "--alt-boundary--"];
  const attachment = [
    "Content-Type: image/png; name=\"logo.png\"",
    "Content-Disposition: attachment; filename=\"logo.png\"",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("fixture-attachment-bytes").toString("base64"),
  ];
  return [
    ...email.authentication.slice(1).map((header) => `Authentication-Results: ${header}`),
    `From: ${email.fromName ? `${encodedWord(email.fromName)} ` : ""}<${email.from}>`,
    `To: <${email.headerTo}>`,
    `Subject: ${encodedWord(email.subject)}`,
    `Date: ${email.sentAt}`,
    `Message-ID: ${email.messageId}`,
    "MIME-Version: 1.0",
    "X-Mailer: Fixture Mailer 1.0",
    "Content-Type: multipart/mixed; boundary=\"mixed-boundary\"",
    "",
    "--mixed-boundary",
    ...alternative,
    "--mixed-boundary",
    ...attachment,
    "--mixed-boundary--",
    "",
  ].join("\r\n");
}

/** One email as the MTA posts it: its raw message, its envelope's recipient and the MTA's stamp, with the secret when given. */
export function inboundRequest(email: InboundTestEmail, secret?: string): { headers: Record<string, string>; body: string } {
  return {
    headers: {
      "content-type": RAW_MESSAGE_TYPE,
      [ENVELOPE_TO_HEADER]: email.to,
      [AUTHENTICATION_RESULTS_HEADER]: email.authentication[0] ?? "",
      ...(secret === undefined ? {} : { [INBOUND_SECRET_HEADER]: secret }),
    },
    body: mimeOf(email),
  };
}

/** A job board's offer alert (on the model of a Cadremploi alert: its text part only CSS, the offers in the HTML). */
export function alertEmail(to: string, options: { from?: string; messageId?: string; authentication?: string | string[] } = {}): InboundTestEmail {
  const from = options.from ?? "offres@alertes.cadremploi.fr";
  return inboundEmail({
    from,
    to,
    messageId: options.messageId,
    authentication: options.authentication,
    text: ".body { font-family: Arial; } .offre { color: #333; }",
    html: `<html><head><style>.offre { color: #333; }</style></head><body>
      <h1>3 nouvelles offres pour vous</h1>
      <div class="offre"><a href="https://www.example-jobs.test/offre/1001">Chef de projet digital H/F</a><p>Exemple Conseil &#8211; Lyon (69) &amp; télétravail</p></div>
      <div class="offre"><a href="https://www.example-jobs.test/offre/1002">Product Owner</a><p>Société Fictive &#8211; Paris (75)</p></div>
      <img src="https://www.example-jobs.test/pixel.gif" alt="">
    </body></html>`,
  });
}

/** A recruiter's message from a sender no list knows (fictional person and company). */
export function unknownSenderEmail(to: string, options: { messageId?: string } = {}): InboundTestEmail {
  return inboundEmail({
    from: "claire.exemple@cabinet-fictif.test",
    to,
    messageId: options.messageId,
    subject: "Opportunité : Directeur de projet SI",
    text: "Bonjour, je me permets de vous contacter pour un poste de Directeur de projet SI. Claire Exemple, 06 00 00 00 00",
  });
}

/**
 * Gmail's forwarding confirmation (#451), sent to the address a Candidate adds in Gmail: written from what Google's help
 * and secondary sources describe (docs/research/issue-451.md), not from a captured email; replace it with one captured
 * on staging once there is one.
 */
export function gmailForwardingConfirmation(to: string, options: { code?: string; requester?: string; messageId?: string } = {}): InboundTestEmail {
  const { code = "123456789", requester = "marie.dupont@gmail.com" } = options;
  return inboundEmail({
    from: "forwarding-noreply@google.com",
    to,
    messageId: options.messageId,
    subject: `(#${code}) Gmail Forwarding Confirmation - Receive Mail from ${requester}`,
    text: [
      `${requester} has requested to automatically forward mail to your email address ${to}.`,
      `Confirmation code: ${code}`,
      `To allow ${requester} to automatically forward mail to your address, please click the link below to confirm the request:`,
      `https://mail-settings.google.com/mail/vf-%5BANGjdJ-fixture-${code}%5D-fixture`,
    ].join("\n\n"),
  });
}
