/**
 * Fictional Brevo Inbound Parsing payloads (#442), written on the model of the corpus of #433 (kept outside the
 * repo): the shape Brevo documents (docs/research/issue-442.md), the senders and authentication a real alert
 * shows, invented offers and people. Never a real email.
 *
 *   inboundPayload(alertEmail({ to: address }))       one email, as Brevo posts it
 *   inboundPayload(a, b)                               several in one delivery
 */

/** One item of Brevo's `items`: only the fields Email intake reads, and a few it must never keep. */
export interface BrevoInboundItem {
  Uuid: string[];
  MessageId: string;
  InReplyTo: string | null;
  From: { Name: string | null; Address: string };
  To: { Name: string | null; Address: string }[];
  Recipients: (string | { Name: string | null; Address: string })[];
  Cc: { Name: string | null; Address: string }[];
  ReplyTo: { Name: string | null; Address: string } | null;
  SentAtDate: string;
  Subject: string;
  RawHtmlBody: string | null;
  RawTextBody: string | null;
  ExtractedMarkdownMessage: string;
  ExtractedMarkdownSignature: string | null;
  Spam?: { Score: number };
  SpamScore?: number;
  Attachments: { Name: string; ContentType: string; ContentLength: number; ContentID: string | null; DownloadToken: string }[];
  Headers: Record<string, string | string[]>;
}

let sequence = 0;

/** Brevo's MX stamp: the first Authentication-Results, the one Email intake trusts. */
export function authenticationResults(domain: string, results: { dmarc?: "pass" | "fail" | "none"; dkim?: string | null; spf?: string | null } = {}): string {
  const { dmarc = "pass", dkim = domain, spf = null } = results;
  return [
    "mx.brevo.test",
    dkim ? `dkim=pass header.d=${dkim} header.s=s1` : "dkim=none",
    spf ? `spf=pass smtp.mailfrom=bounces@${spf}` : "spf=softfail smtp.mailfrom=forwarder@gmail.com",
    `dmarc=${dmarc} header.from=${domain}`,
  ].join("; ");
}

/** An email as Brevo posts it, from `from` to `to`; the rest defaults to an offer alert's shape. */
export function inboundItem(options: {
  from: string;
  to: string;
  authentication?: string | string[];
  html?: string | null;
  text?: string | null;
  subject?: string;
  messageId?: string;
  sentAt?: string;
  recipientsAsStrings?: boolean;
}): BrevoInboundItem {
  sequence += 1;
  const messageId = options.messageId ?? `<fixture-${sequence}@mail.example.test>`;
  return {
    Uuid: [`00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`],
    MessageId: messageId,
    InReplyTo: null,
    From: { Name: "Alertes emploi", Address: options.from },
    To: [{ Name: null, Address: options.to }],
    Recipients: options.recipientsAsStrings ? [options.to] : [{ Name: null, Address: options.to }],
    Cc: [],
    ReplyTo: null,
    SentAtDate: options.sentAt ?? "Mon, 26 Oct 2026 22:18:15 +0000",
    Subject: options.subject ?? "3 nouvelles offres pour « Chef de projet digital »",
    RawHtmlBody: options.html === undefined ? null : options.html,
    RawTextBody: options.text === undefined ? null : options.text,
    ExtractedMarkdownMessage: "",
    ExtractedMarkdownSignature: null,
    SpamScore: 0.4,
    Attachments: [{ Name: "logo.png", ContentType: "image/png", ContentLength: 2048, ContentID: "logo", DownloadToken: "fixture-download-token" }],
    Headers: {
      "Authentication-Results": options.authentication ?? authenticationResults(options.from.split("@")[1]!),
      "Message-ID": messageId,
      "X-Mailer": "Fixture Mailer 1.0",
    },
  };
}

/** A job board's offer alert (on the model of a Cadremploi alert: its text part only CSS, the offers in the HTML). */
export function alertEmail(to: string, options: { from?: string; messageId?: string; authentication?: string | string[] } = {}): BrevoInboundItem {
  const from = options.from ?? "offres@alertes.cadremploi.fr";
  return inboundItem({
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
export function unknownSenderEmail(to: string, options: { messageId?: string } = {}): BrevoInboundItem {
  return inboundItem({
    from: "claire.exemple@cabinet-fictif.test",
    to,
    messageId: options.messageId,
    subject: "Opportunité : Directeur de projet SI",
    text: "Bonjour, je me permets de vous contacter pour un poste de Directeur de projet SI. Claire Exemple, 06 00 00 00 00",
  });
}

/** Brevo's webhook body: `{ items: [...] }`. */
export function inboundPayload(...items: BrevoInboundItem[]): { items: BrevoInboundItem[] } {
  return { items };
}
