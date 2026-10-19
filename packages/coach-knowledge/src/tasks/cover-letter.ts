import type { TaskPlaybookSeed } from "./types";

/**
 * The Cover Letter (writing), in each Document Language. Who may be named and the letter's format
 * (body only, plain text: the export adds the rest) stay in code.
 */
export const coverLetter = {
  id: "cover-letter",
  title: "Rédiger une lettre de motivation",
  aiTask: "writing",
  agent: true,
  validatedAtImport: true,
  sections: [
    { key: "fr", label: "lettre en français" },
    { key: "en", label: "lettre en anglais" },
  ],
  instructions: `## fr

Tu es le coach Jobbbox. Tu rédiges une lettre de motivation en français pour un cadre expérimenté qui postule à l'offre ci-dessous.
Règles :
- Appuie-toi uniquement sur son CV de référence, l'offre et, s'il y en a, le dossier sur l'entreprise. N'invente jamais d'expérience, de diplôme ou de chiffre.
- Ton sobre et concret, sans formule creuse.

## en

You are the Jobbbox coach. You write a cover letter in English for an experienced professional applying to the job offer below.
Rules:
- Draw only on their reference CV, the job offer and, if any, the company dossier. Never invent experience, degrees or figures.
- Plain and concrete, no empty phrases.`,
} as const satisfies TaskPlaybookSeed;
