import { designTokens } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";
import { renderEmail, withSenderAddress, type Email } from "./index";
import { mailClientLint } from "./mail-client-lint";

const digest: Email = {
  language: "fr",
  subject: "Job Digest « DAF » : 2 nouvelles offres",
  title: "2 nouvelles offres pour « DAF »",
  body: [
    "Votre coach a trouvé 2 nouvelles offres pour votre profil « DAF » :",
    { card: { title: "DAF H/F", subtitle: "Acme Industrie, Lyon", details: ["score de correspondance : 92 / 100", "publiée le 20 octobre 2026"], url: "https://app.jobbbox.fr/offres/1" } },
    { card: { title: "Responsable financier", details: ["score de correspondance : 81 / 100"] } },
    { action: { label: "Voir ce Job Digest", url: "https://app.jobbbox.fr/job-digests/9" } },
  ],
  footer: {
    reason: "Vous recevez cet e-mail parce que le Job Digest de votre profil « DAF » est activé.",
    link: { label: "Ne plus recevoir le Job Digest de ce profil", url: "https://app.jobbbox.fr/desabonnement?t=abc" },
  },
};

describe("renderEmail: the plain-text part", () => {
  it("greets, gives the body in order, signs, then the footer under a separator, in the email's language", () => {
    expect(renderEmail(digest).text).toBe(
      [
        "Bonjour,",
        "Votre coach a trouvé 2 nouvelles offres pour votre profil « DAF » :",
        "- DAF H/F (Acme Industrie, Lyon)\n  score de correspondance : 92 / 100\n  publiée le 20 octobre 2026\n  https://app.jobbbox.fr/offres/1",
        "- Responsable financier\n  score de correspondance : 81 / 100",
        "Voir ce Job Digest :\nhttps://app.jobbbox.fr/job-digests/9",
        "L'équipe Jobbbox",
        "--\nVous recevez cet e-mail parce que le Job Digest de votre profil « DAF » est activé.",
        "Ne plus recevoir le Job Digest de ce profil :\nhttps://app.jobbbox.fr/desabonnement?t=abc",
      ].join("\n\n"),
    );
  });

  it("speaks English for an English email", () => {
    const text = renderEmail({ ...digest, language: "en", body: [{ action: { label: "Sign in to Jobbbox", url: "https://x/y" } }], footer: { reason: "Why." } }).text;
    expect(text).toBe("Hello,\n\nSign in to Jobbbox:\nhttps://x/y\n\nThe Jobbbox team\n\n--\nWhy.");
  });

  it("keeps the subject", () => {
    expect(renderEmail(digest).subject).toBe(digest.subject);
  });
});

describe("renderEmail: the HTML part", () => {
  const { html } = renderEmail(digest);

  it("is a whole document in the email's language, laid out in tables", () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="fr"');
    expect(html).toContain("<table");
    expect(html).not.toMatch(/<div|display:\s*(flex|grid)/i);
  });

  it("draws the header: the logo square in the accent colour and « Jobbbox »", () => {
    expect(html).toMatch(new RegExp(`background-color:${designTokens.color.accent.light}[^>]*>J<`));
    expect(html).toContain(">Jobbbox<");
  });

  it("draws the title, the text, each offer card and one primary button to its link", () => {
    expect(html).toContain("2 nouvelles offres pour « DAF »</h1>");
    expect(html).toContain("Votre coach a trouvé 2 nouvelles offres pour votre profil « DAF » :");
    expect(html).toContain('href="https://app.jobbbox.fr/offres/1"');
    expect(html).toContain("Acme Industrie, Lyon · score de correspondance : 92 / 100 · publiée le 20 octobre 2026");
    expect(html).toContain("Responsable financier");
    expect(html.match(/data-button="primary"/g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*href="https:\/\/app\.jobbbox\.fr\/job-digests\/9"[^>]*data-button="primary"[^>]*>Voir ce Job Digest<\/a>/);
  });

  it("ends with the footer: why the email came, its unsubscribe link", () => {
    expect(html).toContain("Vous recevez cet e-mail parce que le Job Digest de votre profil « DAF » est activé.");
    expect(html).toMatch(/<a [^>]*href="https:\/\/app\.jobbbox\.fr\/desabonnement\?t=abc"[^>]*>Ne plus recevoir le Job Digest de ce profil<\/a>/);
  });

  it("takes its colours from the Design System tokens, inline", () => {
    for (const token of ["background", "surface", "border", "text", "secondary", "meta", "accent", "onAccent"] as const) {
      expect(html, token).toContain(designTokens.color[token].light);
    }
    expect(html).toContain(`font-size:${designTokens.density.confort.fontSize.body}px`);
  });

  it("stays legible in a mail client's dark mode: it declares both schemes and the dark token values", () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("prefers-color-scheme: dark");
    for (const token of ["background", "surface", "text", "accent", "onAccent"] as const) {
      expect(html, token).toContain(designTokens.color[token].dark);
    }
  });

  it("passes the mail-client lint", () => {
    expect(mailClientLint(html)).toEqual([]);
  });

  it("escapes what it is given", () => {
    const escaped = renderEmail({ ...digest, title: 'R&D <script>alert("x")</script>', body: [{ action: { label: "Go", url: 'https://x/?a=1&b="2"' } }] }).html;
    expect(escaped).toContain("R&amp;D &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain('href="https://x/?a=1&amp;b=&quot;2&quot;"');
  });

  it("refuses a second primary button, or a link that is not http(s)", () => {
    const action = { action: { label: "Go", url: "https://x" } };
    expect(() => renderEmail({ ...digest, body: [action, action] })).toThrow(/one primary button/);
    expect(() => renderEmail({ ...digest, body: [{ action: { label: "Go", url: "javascript:alert(1)" } }] })).toThrow(/http/);
  });
});

describe("withSenderAddress", () => {
  it("writes the sender's address in the footer", () => {
    const html = withSenderAddress(renderEmail(digest).html, "Jobbbox <hello@jobbbox.ai>");
    expect(html).toMatch(/hello@jobbbox\.ai<\/span>\s*<\/td>/);
  });
});
