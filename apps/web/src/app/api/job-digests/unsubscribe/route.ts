import { unsubscribeResponse } from "@/job-digests/http";
import { getJobDigests } from "@/job-digests/server";

/**
 * Unsubscribes from one Profile's Job Digest with the token of an email's link.
 * Public on purpose: mail clients' one-click unsubscribe (RFC 8058) sends no
 * cookie, and the token alone names the opt-in. See `unsubscribeResponse`.
 */
export async function POST(request: Request) {
  return unsubscribeResponse(request, getJobDigests());
}
