'use strict'
/**
 * What Email intake's MTA decides (#580), apart from Haraka: which recipients it takes, how it posts each accepted
 * email to the app, and the DMARC result it records beside SPF and DKIM. The Haraka plugin
 * (plugins/jobbbox_intake) only wires these to its hooks.
 *
 *   const routes = routesFromEnv(process.env)         // INTAKE_ROUTE_<n>_DOMAIN / _URL / _SECRET
 *   routeFor(routes, "abc@alertes.staging.jobbbox.ai") // the route, or null: refused at RCPT TO (no relay)
 *   await deliver({ routes, recipients, message, authenticationResults, fetch })
 *     // { verdict: "accepted" } | { verdict: "deferred" | "rejected", detail }
 *   await dmarc({ fromDomain, spf, dkim, resolveTxt, organizationalDomain }) // "dmarc=pass (p=reject) header.from=…"
 *
 * One MTA serves every environment on the VPS (only one can listen on port 25): each Email intake domain is a route
 * to its environment's app, with that environment's secret. The app answers 2xx when it took the email (or
 * discarded it unread), 4xx/5xx otherwise: a 5xx, a refused secret, a refused network or no answer at all defer the
 * email (450: its sender delivers it again, the app keeps nothing of a failure), only a body the app reads as no
 * email, or one too large, rejects it (550). Nothing is written to disk.
 */

/** The headers the app reads (apps/web/src/email-intake/inbound-headers.ts; the tests hold both the same). */
const HEADERS = {
  secret: 'x-inbound-secret',
  envelopeTo: 'x-envelope-to',
  authenticationResults: 'x-authentication-results',
  contentType: 'message/rfc822',
}

/** As short a secret as the app takes (EMAIL_INTAKE_INBOUND_SECRET). */
const MIN_SECRET_LENGTH = 32
/** How long the app has to answer, well under what a sender waits after DATA. */
const DEFAULT_TIMEOUT_MS = 60_000
/** The app's answers that reject an email for good: not an email, or too large. Any other failure defers it. */
const REJECTED = new Set([400, 413])

/**
 * @typedef {{ domain: string, url: string, secret: string }} Route
 * @typedef {{ verdict: 'accepted' } | { verdict: 'deferred' | 'rejected', detail: string }} Verdict
 */

/** The routes INTAKE_ROUTE_1_…, INTAKE_ROUTE_2_… name, in order; throws on the first that does not read, so the MTA does not start half set up. */
function routesFromEnv(env) {
  /** @type {Route[]} */
  const routes = []
  for (let n = 1; ; n++) {
    const domain = env[`INTAKE_ROUTE_${n}_DOMAIN`]?.trim().toLowerCase()
    if (!domain) {
      if (n === 1) throw new Error('INTAKE_ROUTE_1_DOMAIN is required: the Email intake domain this MTA takes mail for')
      return routes
    }
    const url = env[`INTAKE_ROUTE_${n}_URL`]?.trim()
    if (!url || !/^https?:\/\//.test(url)) throw new Error(`INTAKE_ROUTE_${n}_URL must be the app's http(s) URL of /api/email-intake/inbound`)
    const secret = env[`INTAKE_ROUTE_${n}_SECRET`]?.trim()
    if (!secret || secret.length < MIN_SECRET_LENGTH) throw new Error(`INTAKE_ROUTE_${n}_SECRET must be the app's EMAIL_INTAKE_INBOUND_SECRET (at least ${MIN_SECRET_LENGTH} characters)`)
    routes.push({ domain, url, secret })
  }
}

/** The route of an address's domain, exactly (not a subdomain); null for any other: the MTA refuses it. */
function routeFor(routes, address) {
  const at = String(address).lastIndexOf('@')
  if (at < 0) return null
  const domain = String(address).slice(at + 1).trim().toLowerCase()
  return routes.find((route) => route.domain === domain) ?? null
}

/** Posts one email to one route's app; what became of it there. */
async function post(route, recipients, message, authenticationResults, fetch, timeoutMs) {
  let response
  try {
    response = await fetch(route.url, {
      method: 'POST',
      headers: {
        'content-type': HEADERS.contentType,
        [HEADERS.secret]: route.secret,
        [HEADERS.envelopeTo]: recipients.join(','),
        // An HTTP header holds one line: the stamp's folding goes.
        [HEADERS.authenticationResults]: authenticationResults.replace(/\r?\n[ \t]*/g, ' ').trim(),
      },
      body: message,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return { verdict: 'deferred', detail: `${route.domain}: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (response.ok) return { verdict: 'accepted' }
  const detail = `${route.domain}: the app answered ${response.status}`
  return { verdict: REJECTED.has(response.status) ? 'rejected' : 'deferred', detail }
}

/**
 * Posts an accepted email to the app of each environment it reached, its recipients grouped by route. Deferred when
 * any app did not take it (delivered again, an app that took it receives it once: it is known by its Message-ID),
 * else rejected when any refused it, else accepted.
 *
 * @param {{ routes: Route[], recipients: string[], message: Buffer, authenticationResults: string, fetch?: typeof globalThis.fetch, timeoutMs?: number }} input
 * @returns {Promise<Verdict>}
 */
async function deliver(input) {
  const { routes, recipients, message, authenticationResults } = input
  const fetch = input.fetch ?? globalThis.fetch
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  /** @type {Map<Route, string[]>} */
  const byRoute = new Map()
  for (const recipient of recipients) {
    const route = routeFor(routes, recipient)
    if (route) byRoute.set(route, [...(byRoute.get(route) ?? []), recipient.trim().toLowerCase()])
  }
  if (byRoute.size === 0) return { verdict: 'rejected', detail: 'no recipient on an Email intake domain' }
  const verdicts = []
  for (const [route, addresses] of byRoute) verdicts.push(await post(route, addresses, message, authenticationResults, fetch, timeoutMs))
  return verdicts.find((verdict) => verdict.verdict === 'deferred') ?? verdicts.find((verdict) => verdict.verdict === 'rejected') ?? { verdict: 'accepted' }
}

/** The DMARC record of a domain (its tags), null when it publishes none that reads; throws when DNS does not answer. */
async function dmarcRecordOf(domain, resolveTxt) {
  let records
  try {
    records = await resolveTxt(`_dmarc.${domain}`)
  } catch (error) {
    if (error && (error.code === 'ENOTFOUND' || error.code === 'ENODATA')) return null
    throw error
  }
  const found = records.map((chunks) => chunks.join('')).filter((record) => /^v\s*=\s*DMARC1\s*(;|$)/i.test(record.trim()))
  if (found.length !== 1) return null // RFC 7489 6.6.3: none, or more than one, is no record.
  const tags = {}
  for (const part of found[0].split(';')) {
    const [name, ...value] = part.split('=')
    if (name && value.length > 0) tags[name.trim().toLowerCase()] = value.join('=').trim().toLowerCase()
  }
  return tags
}

/**
 * The DMARC result of an email (RFC 7489), as an Authentication-Results method: the From domain's record (else its
 * organisation's) says how strictly SPF's and DKIM's domains must match it; it passes when one that passed matches.
 * `none` without a record, `temperror` when DNS does not answer.
 *
 * @param {{ fromDomain: string, spf: { result: string, domain: string } | null, dkim: { result: string, domain: string }[],
 *   resolveTxt: (name: string) => Promise<string[][]>, organizationalDomain: (domain: string) => string }} input
 * @returns {Promise<string>}
 */
async function dmarc(input) {
  const from = input.fromDomain.trim().toLowerCase()
  const organisation = (domain) => input.organizationalDomain(domain.toLowerCase())
  let record
  try {
    record = await dmarcRecordOf(from, input.resolveTxt)
    if (!record && organisation(from) !== from) record = await dmarcRecordOf(organisation(from), input.resolveTxt)
  } catch {
    return `dmarc=temperror header.from=${from}`
  }
  if (!record) return `dmarc=none header.from=${from}`
  const aligned = (mode, domain) => (mode === 's' ? domain.toLowerCase() === from : organisation(domain) === organisation(from))
  const passed = (entry) => entry && String(entry.result).toLowerCase() === 'pass' && entry.domain
  const pass =
    input.dkim.some((signature) => passed(signature) && aligned(record.adkim, signature.domain)) || (passed(input.spf) && aligned(record.aspf, input.spf.domain))
  return `dmarc=${pass ? 'pass' : 'fail'}${record.p ? ` (p=${record.p})` : ''} header.from=${from}`
}

module.exports = { HEADERS, routesFromEnv, routeFor, deliver, dmarc }
