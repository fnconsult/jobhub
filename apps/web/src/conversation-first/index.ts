/**
 * « Conversation au centre » (#601, ADR-0070): the Platform Setting that switches the Candidate's pages to the
 * conversation-first design while it is being built. On, the home page is a new Free conversation (the page itself, its
 * box at the foot), the Sidebar has « Nouvelle conversation » and « Coach » with the Free conversations, and the Top Bar
 * has « Effacer » instead of « Aide et coach ». Off by default, and nothing changes; super-admins switch it in Paramètres'
 * Environnement tab, recorded in the Back Office Audit like every Platform Setting. #608 switches it on for good and
 * removes it.
 */
import type { PlatformSettingsSnapshot } from "../platform-settings/resolver";

export const CONVERSATION_FIRST = "CONVERSATION_FIRST";

/** Whether « Conversation au centre » is on: the Back Office's value, else env's, else off. A value it does not take is off. */
export function conversationFirst(settings: PlatformSettingsSnapshot): boolean {
  const setting = settings.setting(CONVERSATION_FIRST);
  return Boolean(setting?.valid) && setting?.value === "true";
}
