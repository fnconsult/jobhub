/**
 * How Email intake's MTA posts each email it accepts to `POST /api/email-intake/inbound` (#580): the raw message
 * (`content-type: message/rfc822`) and, beside it, these headers. The MTA (apps/mta) sends them; the route reads them.
 * Kept free of imports, so the MTA's tests and the e2e fixtures can read the same names.
 */

/** The shared secret (EMAIL_INTAKE_INBOUND_SECRET); a bearer token is taken too. */
export const INBOUND_SECRET_HEADER = "x-inbound-secret";
/** The envelope's recipients (RCPT TO) the MTA accepted, comma-separated: the Forwarding addresses. */
export const ENVELOPE_TO_HEADER = "x-envelope-to";
/**
 * The MTA's own Authentication-Results (SPF, DKIM, DMARC), unfolded on one line. The only one Email intake trusts:
 * any the message carries was written by someone else.
 */
export const AUTHENTICATION_RESULTS_HEADER = "x-authentication-results";
/** The raw message's media type. */
export const RAW_MESSAGE_TYPE = "message/rfc822";
