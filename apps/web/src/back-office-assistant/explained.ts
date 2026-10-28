/**
 * The context an Explainable label sends with its question (#407, ADR-0042): untrusted input from the browser, read
 * by `explainedSchema`, and told to the Back Office Assistant by `explainedText` with the question it goes with.
 *
 * It is what the Administrator sees on the page, framed as unverified data the assistant never takes as an
 * instruction. A secret's value never goes in, whatever the browser sends: an item naming a Provider Secret, or a
 * variable Paramètres never shows the value of, is told without its value. Email addresses are masked by the caller,
 * with the rest of what the assistant is told.
 */
import * as z from "zod";
import { ENV_ONLY_SETTINGS } from "../platform-settings/catalog";
import { isProviderSecretName } from "../provider-secrets/catalog";
import { EXPLAINED_KINDS, MAX_EXPLAINED_LENGTH, type ExplainedItem, type ExplainedKind } from "./conversation";

const field = z.string().trim().min(1).max(MAX_EXPLAINED_LENGTH);

export const explainedSchema = z.object({
  label: field,
  page: field,
  tab: field.optional(),
  kind: z.enum(EXPLAINED_KINDS),
  id: field,
  value: z.string().trim().max(MAX_EXPLAINED_LENGTH).optional(),
  source: field.optional(),
  state: field.optional(),
});

/** The instruction the assistant is given while a conversation holds a question asked from an Explainable label. */
export const EXPLAINING = `- Une question posée depuis un libellé explicable du Back Office (« Explique-moi « … » ici. ») est suivie du contexte de l'élément, entre <donnees> et </donnees> : explique cet élément à cet endroit, en t'appuyant sur ce contexte et sur ce que tu sais du Back Office : ce qu'il fait, sa valeur en vigueur et d'où elle vient, pourquoi il est indisponible s'il l'est, ce qu'un changement ferait. Tu ne changes rien.`;

const KIND_NAMES: Record<ExplainedKind, string> = {
  setting: "réglage",
  source: "source de la recherche d'offres",
  warning: "avertissement",
  intro: "présentation de la page",
  figure: "chiffre du tableau de bord",
  stop_reason: "raison d'arrêt d'une recherche",
  recognised_sender: "expéditeur reconnu de la Réception par email",
};

/** Whether an item named `id` may hold a secret: a Provider Secret, or a variable whose value Paramètres never shows. */
function holdsSecret(id: string): boolean {
  if (isProviderSecretName(id)) return true;
  const envOnly = (ENV_ONLY_SETTINGS as Record<string, { shown: string | false }>)[id];
  return envOnly !== undefined && envOnly.shown !== "value";
}

/** Text the browser sent, as data that can neither close its frame nor open another. */
const unframed = (text: string) => text.replace(/</g, "‹").replace(/>/g, "›");

/** The item's context as the assistant is told it, after the question: one line per field the item has. */
export function explainedText(item: ExplainedItem): string {
  const value = holdsSecret(item.id) ? undefined : item.value;
  const lines = [
    `Libellé : ${item.label}`,
    `Page : ${item.page}`,
    item.tab ? `Onglet : ${item.tab}` : null,
    `Élément : ${KIND_NAMES[item.kind]} ${item.id}`,
    value !== undefined ? `Valeur : ${value || "(aucune)"}` : null,
    item.source ? `Source : ${item.source}` : null,
    item.state ? `État : ${item.state}` : null,
  ].filter((line): line is string => line !== null);
  return `Contexte de l'élément (libellé explicable) :\n<donnees>\n${unframed(lines.join("\n"))}\n</donnees>`;
}
