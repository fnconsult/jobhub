/**
 * The name of « Mon compte », the menu button in the Candidate's Sidebar foot (#923): « Mon compte », then the name the
 * Candidate is called by and their Plan when there are, « Mon compte, Mimi, Premium ». `account` is the catalogue's
 * « Mon compte » in the page's language.
 */
export function accountButtonName(account: string): RegExp {
  return new RegExp(`^${account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(, |$)`);
}
