import { describe, expect, it } from "vitest";
import { scrubSecrets } from "./scrub-secrets";

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
