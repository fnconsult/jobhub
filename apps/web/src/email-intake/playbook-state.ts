/**
 * Email intake held back by its Task Playbook (ADR-0052): reading an offer email runs only on a served version
 * of « Lire un email d'offres d'emploi ». In production that is one a person Human-validated; elsewhere the
 * latest (ADR-0026). While none is served, Email intake counts as off whatever its switch, and its source on
 * the Sources tab of Paramètres says why.
 *
 *   const reason = await emailIntakeHeldBack(getTaskPlaybooks());
 *   if (reason) t(`admin.platformSettings.sources.reasons.${reason}`); // « Indisponible : en attente de validation du playbook »
 */
import type { TaskPlaybookReader } from "../task-playbooks";

/** Its Task Playbook: the version served is the one each email is read with. */
export const EMAIL_READING_PLAYBOOK = "job-offer-email-reading";

/** Why Email intake is held back, as the Sources tab's reason code. */
export type EmailIntakeHeldBack = "playbook_pending";

/**
 * Why Email intake counts as off whatever its switch: "playbook_pending" while no version of its Task Playbook is
 * served (or it cannot be read: no email is read without one); null when one is.
 */
export async function emailIntakeHeldBack(reader: TaskPlaybookReader): Promise<EmailIntakeHeldBack | null> {
  try {
    return (await reader(EMAIL_READING_PLAYBOOK)) ? null : "playbook_pending";
  } catch {
    return "playbook_pending";
  }
}
