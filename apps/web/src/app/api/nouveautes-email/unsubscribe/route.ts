import { unsubscribeResponse } from "@/nouveautes-email/http";
import { getNouveautesEmails } from "@/nouveautes-email/server";

/**
 * Unsubscribes from the Nouveautés email with the token of an email's link (#566). Public on purpose: mail clients'
 * one-click unsubscribe (RFC 8058) sends no cookie, and the token alone names the subscription.
 */
export async function POST(request: Request) {
  return unsubscribeResponse(request, getNouveautesEmails());
}
