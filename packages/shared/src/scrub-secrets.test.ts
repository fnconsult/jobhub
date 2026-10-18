import { describe, expect, it } from "vitest";
import { scrubSecrets, scrubStoredText } from "./scrub-secrets";

describe("scrubbing secrets out of a provider's error text", () => {
  it("removes the keys it is given, wherever they appear", () => {
    const key = "e2e-mistral-key-0123";

    expect(scrubSecrets(`HTTP 401 {"message":"Invalid key ${key}"} (was ${key})`, [key])).toBe('HTTP 401 {"message":"Invalid key [redacted]"} (was [redacted])');
  });

  it("removes a partly masked echo of a known key: its first or last characters", () => {
    expect(scrubSecrets("key sk-abcd…wxyz is revoked", ["sk-abcdefghijklmnopqrstuvwxyz"])).not.toMatch(/abcd|wxyz/);
  });

  it("removes what looks like a credential even when it was not given", () => {
    const text = [
      "Authorization: Bearer abc.def-ghi_jkl",
      'api_key="lsh_0123456789abcdef"',
      "secret sk_live_51Habcdefghijklmnop",
      "token AKIA0123456789ABCDEF0123456789abcdef0123",
    ].join("\n");

    const scrubbed = scrubSecrets(text);

    for (const leaked of ["abc.def-ghi_jkl", "lsh_0123456789abcdef", "sk_live_51Habcdefghijklmnop", "AKIA0123456789ABCDEF0123456789abcdef0123"]) {
      expect(scrubbed).not.toContain(leaked);
    }
    expect(scrubbed).toContain("Authorization: Bearer [redacted]");
  });

  it("keeps an ordinary error message as it is", () => {
    const message = 'HTTP 429 {"error":"rate limited","retry_after":30}';

    expect(scrubSecrets(message, ["unrelated-key-value"])).toBe(message);
  });

  it("ignores empty or very short given values, which would blank the message", () => {
    expect(scrubSecrets("HTTP 500 internal error", ["", " ", "a"])).toBe("HTTP 500 internal error");
  });
});

describe("scrubbing credentials out of a URL", () => {
  it("removes a URL's user and password (SMTP_URL), keeping the host", () => {
    const scrubbed = scrubSecrets("SMTP: connect failed to smtps://9a1b2c@smtp-brevo.com:Xs0meP4ss@smtp-relay.brevo.com:465 (timeout)");

    expect(scrubbed).not.toMatch(/9a1b2c|Xs0meP4ss/);
    expect(scrubbed).toContain("smtp-relay.brevo.com:465");
  });
});

describe("scrubbing secrets out of stored text (an AI call's prompt and reply, #218)", () => {
  it("removes given keys, labelled values, bearer tokens, provider key shapes and a URL's password, like scrubSecrets", () => {
    const text = "clé e2e-mistral-key-0123, api_key=abcdef123456, Bearer abc.def, sk_live_51Habcdefghijklmnop, smtps://user:pass@smtp.example";

    const scrubbed = scrubStoredText(text, ["e2e-mistral-key-0123"]);

    expect(scrubbed).not.toMatch(/e2e-mistral|abcdef123456|abc\.def|sk_live|user:pass/);
    expect(scrubbed).toContain("smtp.example");
  });

  it("removes a long credential-shaped token: letters and digits run together", () => {
    expect(scrubStoredText("jeton AKIA0123456789ABCDEF0123456789abcdef0123 fin")).toBe("jeton [redacted] fin");
    expect(scrubStoredText("eyJhbGciOiJIUzI1NiJ9xyzABC0123456789qwerty")).toBe("[redacted]");
  });

  it("keeps UUIDs, URL slugs and long ordinary words", () => {
    const text = [
      "Profil 6ea8e01c-2313-486c-8ef9-7ee619a374fa",
      "https://www.apec.fr/candidat/recherche-emploi/offre/directeur-administratif-et-financier-h-f-lyon-2026",
      "anticonstitutionnellement_intergouvernementalisation",
    ].join("\n");

    expect(scrubStoredText(text)).toBe(text);
  });
});
