/** What a scrubbed secret is replaced with. */
const REDACTED = "[redacted]";

/** A given value shorter than this is not scrubbed: it would blank ordinary words. */
const MIN_KNOWN = 6;
/** How many first or last characters of a known key a provider may echo when it masks it. */
const ECHO = 4;

const PATTERNS: RegExp[] = [
  // Authorization: Bearer <token>, Basic <token>
  /\b(Bearer|Basic)\s+[^\s"',;]+/gi,
  // api_key=…, "apiKey": "…", client_secret: …, password=…
  /\b((?:api[_-]?key|apikey|x-api-key|client[_-]?secret|secret|password|token|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
  // Provider key shapes: sk-…, sk_live_…, rk_test_…, whsec_…, pplx-…
  /\b(?:sk|rk|pk|whsec|pplx|lsh)[-_][A-Za-z0-9_-]{8,}/g,
  // Anything long and token-like: 32+ characters of letters, digits, - and _.
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `text` (a provider's error message or answer body) without secrets, before it is
 * logged or stored: every value of `known` (the keys in use), a partly masked echo
 * of one (its first or last 4 characters next to an ellipsis or asterisks), and
 * whatever looks like a credential.
 */
export function scrubSecrets(text: string, known: readonly (string | undefined)[] = []): string {
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
  scrubbed = scrubbed.replace(PATTERNS[0]!, (_, scheme: string) => `${scheme} ${REDACTED}`);
  scrubbed = scrubbed.replace(PATTERNS[1]!, (_, label: string) => `${label}${REDACTED}`);
  for (const pattern of PATTERNS.slice(2)) scrubbed = scrubbed.replace(pattern, (match) => (match === REDACTED ? match : REDACTED));
  return scrubbed;
}
