/** What a scrubbed secret is replaced with. */
const REDACTED = "[redacted]";

/** A given value shorter than this is not scrubbed: it would blank ordinary words. */
const MIN_KNOWN = 6;
/** How many first or last characters of a known key a provider may echo when it masks it. */
const ECHO = 4;

/** A URL's user and password (smtps://user:pass@host): up to the last @ before the host. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/"']*@/gi;

const PATTERNS: RegExp[] = [
  // Authorization: Bearer <token>, Basic <token>
  /\b(Bearer|Basic)\s+[^\s"',;]+/gi,
  // api_key=…, "apiKey": "…", client_secret: …, password=…
  /\b((?:api[_-]?key|apikey|x-api-key|client[_-]?secret|secret|password|token|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
  // Provider key shapes: sk-…, sk_live_…, rk_test_…, whsec_…, pplx-…, xkeysib-… (Brevo)
  /\b(?:sk|rk|pk|whsec|pplx|lsh|xkeysib|xsmtpsib)[-_][A-Za-z0-9_-]{8,}/g,
  // Anything long and token-like: 32+ characters of letters, digits, - and _.
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `text` (a provider's error message or answer body) without secrets, before it is
 * logged or stored: every value of `known` (the keys in use), a partly masked echo
 * of one (its first or last 4 characters next to an ellipsis or asterisks), a URL's
 * user and password, and whatever looks like a credential.
 */
export function scrubSecrets(text: string, known: readonly (string | undefined)[] = []): string {
  return scrub(text, known, () => true);
}

/** A run of letters and digits long enough, and mixed enough, to be a key rather than a word. */
const CREDENTIAL_RUN = /[A-Za-z0-9]{24,}/g;
const credentialShaped = (token: string) => (token.match(CREDENTIAL_RUN) ?? []).some((run) => /\d/.test(run) && /[A-Za-z]/.test(run));

/**
 * Stored text (an AI call's prompt and reply, #218) without secrets: as `scrubSecrets`, except that a
 * long token is removed only when credential-shaped (a long run of letters and digits mixed), so
 * UUIDs, URL slugs and long words survive.
 */
export function scrubStoredText(text: string, known: readonly (string | undefined)[] = []): string {
  return scrub(text, known, credentialShaped);
}

function scrub(text: string, known: readonly (string | undefined)[], longToken: (token: string) => boolean): string {
  let scrubbed = text;
  for (const value of known) {
    const secret = value?.trim();
    if (!secret || secret.length < MIN_KNOWN) continue;
    scrubbed = scrubbed.split(secret).join(REDACTED);
    if (secret.length >= ECHO * 3) {
      const [head, tail] = [escape(secret.slice(0, ECHO)), escape(secret.slice(-ECHO))];
      scrubbed = scrubbed.replace(new RegExp(`${head}[^\\s"']*(?:…|\\.\\.\\.|\\*+)[^\\s"']*${tail}`, "g"), REDACTED);
    }
  }
  scrubbed = scrubbed.replace(URL_USERINFO, (_, scheme: string) => `${scheme}${REDACTED}@`);
  scrubbed = scrubbed.replace(PATTERNS[0]!, (_, scheme: string) => `${scheme} ${REDACTED}`);
  scrubbed = scrubbed.replace(PATTERNS[1]!, (_, label: string) => `${label}${REDACTED}`);
  scrubbed = scrubbed.replace(PATTERNS[2]!, (match) => (match === REDACTED ? match : REDACTED));
  scrubbed = scrubbed.replace(PATTERNS[3]!, (match) => (match === REDACTED || !longToken(match) ? match : REDACTED));
  return scrubbed;
}
