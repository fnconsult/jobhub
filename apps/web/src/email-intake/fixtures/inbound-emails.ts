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
  /** The Message-ID it answers (In-Reply-To and References), when it is a reply. */
  inReplyTo: string | null;
  /**
   * The Authentication-Results: the first is the MTA's own stamp (sent beside the message), any other one a header
   * the message itself carried, which anyone can write.
   */
  authentication: string[];
  /** A message it forwards as an attachment (`message/rfc822`), raw, and that part's disposition. */
  attachedMessage: { raw: string; disposition: "attachment" | "inline" | null } | null;
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
  inReplyTo?: string;
  attachedMessage?: InboundTestEmail["attachedMessage"];
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
    inReplyTo: options.inReplyTo ?? null,
    authentication: Array.isArray(authentication) ? authentication : [authentication],
    attachedMessage: options.attachedMessage ?? null,
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
    ...(email.inReplyTo ? [`In-Reply-To: ${email.inReplyTo}`, `References: ${email.inReplyTo}`] : []),
    "MIME-Version: 1.0",
    "X-Mailer: Fixture Mailer 1.0",
    "Content-Type: multipart/mixed; boundary=\"mixed-boundary\"",
    "",
    "--mixed-boundary",
    ...alternative,
    "--mixed-boundary",
    ...attachment,
    ...(email.attachedMessage
      ? [
          "--mixed-boundary",
          "Content-Type: message/rfc822; name=\"alerte.eml\"",
          ...(email.attachedMessage.disposition ? [`Content-Disposition: ${email.attachedMessage.disposition}; filename="alerte.eml"`] : []),
          "",
          email.attachedMessage.raw,
        ]
      : []),
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

/**
 * A recruiter's answer about an Application (#1099): an invitation to an interview from the employer's own domain, a
 * fictional company and person.
 */
export function recruiterEmail(to: string, options: { from?: string; messageId?: string; inReplyTo?: string; text?: string; subject?: string; authentication?: string | string[] } = {}): InboundTestEmail {
  const from = options.from ?? "jane.recruiter@benchling.com";
  const email = inboundEmail({
    from,
    to,
    subject: options.subject ?? "Votre candidature : Data scientist",
    text: options.text ?? "Bonjour Marie,\n\nMerci pour votre candidature. Seriez-vous disponible mardi à 14 h pour un premier entretien ?\n\nJane, Talent Acquisition",
    ...(options.messageId ? { messageId: options.messageId } : {}),
    ...(options.inReplyTo ? { inReplyTo: options.inReplyTo } : {}),
    ...(options.authentication ? { authentication: options.authentication } : {}),
  });
  return { ...email, fromName: "Jane Recruiter" };
}

/** The Candidate's own address at iCloud, from which they forward by hand (fictional). */
export const ICLOUD_ADDRESS = "marie.exemple@icloud.example";

/** The job board an alert forwarded from iCloud comes from (fictional). */
export const ALERT_SENDER = "offres@alertes.example-jobs.test";

/** The HTML of an alert as its job board sends it: a hidden preheader, offers each with its link. */
const ALERT_BODY = `<div style="display:none;max-height:0">2 nouvelles offres pour vous</div>
  <h1>2 nouvelles offres pour « Contrôleur de gestion »</h1>
  <table><tr><td><a href="https://www.example-jobs.test/offre/2001?utm_source=alerte">Contrôleur de gestion H/F</a><p>Société Fictive &#8211; Nantes (44)</p></td></tr>
  <tr><td><a href="https://www.example-jobs.test/offre/2002?utm_source=alerte">Responsable contrôle de gestion</a><p>Exemple Industrie &#8211; Rennes (35)</p></td></tr></table>`;

/**
 * An alert the Candidate forwarded by hand from Apple Mail (Mac, iPhone) or iCloud Mail, inline (#1193): Apple Mail's
 * HTML, its forward in a `<blockquote type="cite">` under « Début du message réexpédié : » (fr) or « Begin forwarded
 * message: » (en), each header in bold, then the alert's own HTML, head and all. Written from Apple Mail's structure,
 * never from a real email.
 */
export function appleMailForward(to: string, locale: "fr" | "en", options: { from?: string; messageId?: string } = {}): InboundTestEmail {
  const from = options.from ?? ICLOUD_ADDRESS;
  const words =
    locale === "fr"
      ? { begin: "Début du message réexpédié :", from: "De", subject: "Objet", date: "Date", to: "À", sent: "26 novembre 2026 à 18:00:00 UTC+1", signature: "Envoyé de mon iPhone" }
      : { begin: "Begin forwarded message:", from: "From", subject: "Subject", date: "Date", to: "To", sent: "November 26, 2026 at 6:00:00 PM GMT+1", signature: "Sent from my iPhone" };
  const header = (name: string, value: string) =>
    `<div style="margin-top: 0px; margin-right: 0px; margin-bottom: 0px; margin-left: 0px;"><span style="font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif; color:rgba(0, 0, 0, 1.0);"><b>${name}: </b></span><span style="font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif;">${value}<br></span></div>`;
  const html = `<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body style="overflow-wrap: break-word; -webkit-nbsp-mode: space; line-break: after-white-space;"><br id="lineBreakAtBeginningOfMessage"><div>${words.signature}<br><blockquote type="cite"><div>${words.begin}</div><br class="Apple-interchange-newline">${header(words.from, `Alertes Emploi &lt;${ALERT_SENDER}&gt;`)}${header(words.subject, "<b>2 nouvelles offres pour « Contrôleur de gestion »</b>")}${header(words.date, words.sent)}${header(words.to, `&lt;${from}&gt;`)}<br><div><meta charset="utf-8"><title>Vos alertes</title><style>td { font-family: Arial; }</style>${ALERT_BODY}</div></blockquote></div></body></html>`;
  const text = `${words.signature}\n\n${words.begin}\n\n${words.from}: Alertes Emploi <${ALERT_SENDER}>\n${words.subject}: 2 nouvelles offres pour « Contrôleur de gestion »\n${words.date}: ${words.sent}\n${words.to}: <${from}>\n\nContrôleur de gestion H/F`;
  return inboundEmail({
    from,
    to,
    headerTo: to,
    subject: `${locale === "fr" ? "Tr" : "Fwd"}: 2 nouvelles offres pour « Contrôleur de gestion »`,
    sentAt: "Thu, 26 Nov 2026 18:00:04 +0100",
    html,
    text,
    authentication: authenticationResults(from.split("@")[1]!),
    ...(options.messageId ? { messageId: options.messageId } : {}),
  });
}

/**
 * An alert the Candidate forwarded as an attachment from Apple Mail or iCloud Mail (« Transférer en tant que pièce
 * jointe », #1193): their message says nothing, the alert is a `message/rfc822` part, as `disposition` writes it.
 */
export function appleMailAttachmentForward(to: string, options: { from?: string; disposition?: "attachment" | "inline" | null; messageId?: string } = {}): InboundTestEmail {
  const from = options.from ?? ICLOUD_ADDRESS;
  const raw = [
    `From: ${encodedWord("Alertes Emploi")} <${ALERT_SENDER}>`,
    `To: <${ICLOUD_ADDRESS}>`,
    `Subject: ${encodedWord("2 nouvelles offres pour « Contrôleur de gestion »")}`,
    "Date: Thu, 26 Nov 2026 18:00:00 +0100",
    "Message-ID: <alerte-2001@alertes.example-jobs.test>",
    "MIME-Version: 1.0",
    ...textPart("html", `<html><head><style>td { font-family: Arial; }</style></head><body>${ALERT_BODY}</body></html>`),
  ].join("\r\n");
  return inboundEmail({
    from,
    to,
    subject: "Fwd: 2 nouvelles offres pour « Contrôleur de gestion »",
    text: "",
    authentication: authenticationResults(from.split("@")[1]!),
    attachedMessage: { raw, disposition: options.disposition === undefined ? "attachment" : options.disposition },
    ...(options.messageId ? { messageId: options.messageId } : {}),
  });
}
