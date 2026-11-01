'use strict'
/**
 * Email intake's Haraka plugin (#580): the hooks only, the decisions are src/intake.js's (and its tests').
 *  - rcpt: takes a recipient only on an Email intake domain of a route (550 for any other: no relay);
 *  - data_post (after spf and dkim in config/plugins): records the DMARC result beside theirs;
 *  - queue: posts the email to its environment's app, and answers the sender as the app answered (250, 450 or 550).
 * Nothing is queued on disk: the email is in memory (connection.ini spool_after=-1) until the app has it.
 */
const dns = require('node:dns').promises
const constants = require('haraka-constants')
const tld = require('haraka-tld')
const { parseHeader } = require('@haraka/email-address')
const intake = require('../../src/intake.js')

const addressOf = (address) => (typeof address?.address === 'function' ? address.address() : String(address?.address ?? ''))

exports.register = function () {
  this.routes = intake.routesFromEnv(process.env)
  this.loginfo(`Email intake domains: ${this.routes.map((route) => route.domain).join(', ')}`)
  this.register_hook('rcpt', 'take_intake_domains')
  this.register_hook('data_post', 'record_dmarc')
  this.register_hook('queue', 'post_to_app')
}

exports.take_intake_domains = function (next, connection, params) {
  const route = intake.routeFor(this.routes, addressOf(params[0]))
  if (route) return next(constants.ok)
  next(constants.deny, 'relaying denied: this server only takes mail for its own domains')
}

exports.record_dmarc = function (next, connection) {
  const txn = connection.transaction
  if (!txn) return next()
  let fromDomain = null
  try {
    fromDomain = parseHeader(txn.header.get_decoded('From') || '')?.[0]?.host?.toLowerCase() ?? null
  } catch (error) {
    connection.logwarn(this, `From does not read: ${error.message}`)
  }
  if (!fromDomain) return next()
  const spf = txn.results.get('spf')
  intake
    .dmarc({
      fromDomain,
      spf: spf?.scope === 'mfrom' && spf.domain ? { result: String(spf.result ?? ''), domain: spf.domain } : null,
      dkim: (txn.notes.dkim_results ?? []).map((result) => ({ result: String(result.result ?? ''), domain: String(result.domain ?? '') })),
      resolveTxt: (name) => dns.resolveTxt(name),
      organizationalDomain: (domain) => tld.get_organizational_domain(domain) ?? domain,
    })
    .then(
      (result) => {
        connection.auth_results(result)
        next()
      },
      (error) => {
        connection.logerror(this, `DMARC: ${error.message}`)
        next()
      },
    )
}

exports.post_to_app = function (next, connection) {
  const txn = connection.transaction
  if (!txn) return next()
  const recipients = txn.rcpt_to.map(addressOf)
  txn.message_stream.get_data((message) => {
    intake
      .deliver({ routes: this.routes, recipients, message, authenticationResults: connection.auth_results() })
      .then((verdict) => {
        if (verdict.verdict === 'accepted') return next(constants.ok, 'delivered to Jobbbox')
        connection.logwarn(this, `${verdict.verdict}: ${verdict.detail}`)
        if (verdict.verdict === 'rejected') return next(constants.deny, 'message refused')
        next(constants.denysoft, 'temporary failure, try again later')
      })
      .catch((error) => {
        connection.logerror(this, error.message)
        next(constants.denysoft, 'temporary failure, try again later')
      })
  })
}
