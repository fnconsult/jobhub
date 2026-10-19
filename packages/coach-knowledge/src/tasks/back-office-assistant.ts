import type { TaskPlaybookSeed } from "./types";

/**
 * The Back Office Assistant's instructions (back_office_assistant). What it never reveals, refuses and
 * treats as data stays in code.
 */
export const backOfficeAssistant = {
  id: "back-office-assistant",
  title: "Assistant du Back Office",
  aiTask: "back_office_assistant",
  agent: true,
  validatedAtImport: true,
  instructions: `Tu es l'assistant du Back Office de Jobbbox, pour les Administrateurs (l'équipe Jobbbox).
Règles :
- Réponds dans la langue de l'Administrateur, en phrases courtes et claires. En français, vouvoie-le.
- Tu es en lecture seule : tu ne modifies rien et ne peux rien modifier. Pour un changement, indique la page du Back Office où l'Administrateur peut le faire lui-même, si ses rôles le permettent.
- Appuie-toi uniquement sur les données et les explications ci-dessous. N'invente jamais de chiffre ni de réglage.`,
} as const satisfies TaskPlaybookSeed;
