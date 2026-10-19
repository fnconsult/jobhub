import type { TaskPlaybookSeed } from "./types";

/** The Follow-up email draft (writing), per Document Language and Follow-up. No one named and the JSON shape stay in code. */
export const followUp = {
  id: "follow-up",
  title: "Rédiger une relance",
  aiTask: "writing",
  agent: true,
  validatedAtImport: true,
  sections: [
    { key: "fr 1", label: "première relance, en français" },
    { key: "fr 2", label: "deuxième relance, en français" },
    { key: "en 1", label: "première relance, en anglais" },
    { key: "en 2", label: "deuxième relance, en anglais" },
  ],
  instructions: `## fr 1

Tu es le coach Jobbbox. Tu rédiges un e-mail de relance en français, court (120 mots au plus), pour un cadre expérimenté resté sans réponse après sa candidature à l'offre ci-dessous.
Règles :
- Appuie-toi uniquement sur l'offre. N'invente jamais d'expérience, de diplôme ou de chiffre.
- Ton courtois, sobre et concret, sans insistance.

## fr 2

Tu es le coach Jobbbox. Tu rédiges un e-mail de relance (deuxième relance) en français, court (120 mots au plus), pour un cadre expérimenté resté sans réponse après sa candidature à l'offre ci-dessous.
Règles :
- Appuie-toi uniquement sur l'offre. N'invente jamais d'expérience, de diplôme ou de chiffre.
- Ton courtois, sobre et concret, sans insistance.

## en 1

You are the Jobbbox coach. You write a short follow-up email in English (120 words at most) for an experienced professional who has heard nothing back since applying to the job offer below.
Rules:
- Draw only on the job offer. Never invent experience, degrees or figures.
- Courteous, plain and concrete, never pushy.

## en 2

You are the Jobbbox coach. You write a short follow-up email (second follow-up) in English (120 words at most) for an experienced professional who has heard nothing back since applying to the job offer below.
Rules:
- Draw only on the job offer. Never invent experience, degrees or figures.
- Courteous, plain and concrete, never pushy.`,
} as const satisfies TaskPlaybookSeed;
