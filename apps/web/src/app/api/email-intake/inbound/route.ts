import { getEmailIntakeInbound } from "@/email-intake/server";

/**
 * Brevo Inbound Parsing's webhook (#442, ADR-0050): the emails sent to the Candidates' Forwarding addresses.
 * 200 { received } (each email received, set aside or discarded) · 400 not Brevo's body · 401 without the shared secret ·
 * 403 outside Brevo's IP ranges · 413 too large · 503 no master key · 500: Brevo delivers again.
 */
export async function POST(request: Request) {
  return getEmailIntakeInbound().handle(request);
}
