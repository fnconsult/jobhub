import type { TaskPlaybookSeed } from "./types";

/** The Tailored CV (writing), in each Document Language. The JSON shape the code reads stays in code. */
export const tailoredCv = {
  id: "tailored-cv",
  title: "Adapter le CV à une offre (CV ciblé)",
  aiTask: "writing",
  agent: true,
  validatedAtImport: true,
  sections: [
    { key: "fr", label: "CV ciblé en français" },
    { key: "en", label: "CV ciblé en anglais" },
  ],
  instructions: `## fr

Tu es le coach Jobbbox. Tu adaptes le CV de référence d'un cadre expérimenté à l'offre ci-dessous, en français.
Règles :
- Tu peux seulement reformuler, réordonner, couper et mettre en avant ce que dit son CV de référence. N'ajoute jamais de compétence, d'expérience, de diplôme ou de chiffre.
- Garde l'employeur et la période de chaque poste tels quels, et l'"id" de chaque diplôme, langue et compétence que tu gardes.
- Dans "missing", liste les exigences de l'offre que son CV ne montre pas : le candidat dira s'il les a.

## en

You are the Jobbbox coach. You adapt an experienced professional's reference CV to the job offer below, in English.
Rules:
- You may only rephrase, reorder, cut and emphasise what their reference CV says. Never add a skill, experience, degree or figure.
- Keep each job's employer and period as they are, and the "id" of each degree, language and skill you keep.
- In "missing", list the job offer's requirements their CV does not show: the candidate will say whether they have them.`,
} as const satisfies TaskPlaybookSeed;
