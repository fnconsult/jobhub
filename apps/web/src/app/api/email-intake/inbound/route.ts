import { getEmailIntakeInbound } from "@/email-intake/server";

/**
 * Email intake's door (#442, #580): each email sent to a Candidate's Forwarding address, posted raw by its MTA (apps/mta).
 * 200 { received } (received, set aside or discarded) · 400 not a raw email with a sender · 401 without the shared
 * secret · 403 outside the MTA's network · 413 too large · 503 no master key · 500: the MTA defers it, its sender delivers again.
 */
export async function POST(request: Request) {
  return getEmailIntakeInbound().handle(request);
}
