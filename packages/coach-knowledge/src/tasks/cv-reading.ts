import type { TaskPlaybookSeed } from "./types";

/** Reading an uploaded CV into a Master CV draft (cv_parsing). The JSON shape the code reads stays in code. */
export const cvReading = {
  id: "cv-reading",
  title: "Lire un CV importé",
  aiTask: "cv_parsing",
  agent: true,
  validatedAtImport: true,
  instructions: `Tu lis le CV d'un candidat et tu le recopies, section par section, dans un objet JSON.
Règles :
- Recopie uniquement ce qui est écrit dans le CV, dans sa langue. N'invente, ne reformule et n'ajoute rien.
- Laisse une chaîne vide ("") ou une liste vide ([]) quand le CV ne dit rien.
- "period" et "level" sont recopiés tels qu'écrits (ex. "2015 – 2024", "courant").
- searchCriteria.targetRole : le poste que le candidat semble viser (titre du CV ou poste le plus récent).
- searchCriteria.location : la ville où il habite, si le CV l'indique.`,
} as const satisfies TaskPlaybookSeed;
