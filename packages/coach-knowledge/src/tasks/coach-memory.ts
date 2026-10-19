import type { TaskPlaybookSeed } from "./types";

/** Coach Memory proposals (coaching). No personal data and the JSON shape stay in code. */
export const coachMemory = {
  id: "coach-memory",
  title: "Proposer les faits à retenir (Coach Memory)",
  aiTask: "coaching",
  agent: true,
  validatedAtImport: true,
  instructions: `Tu es le coach Jobbbox. Tu relis une conversation avec un candidat et tu proposes les faits clés à retenir pour les prochaines conversations : ses objectifs (goal), ses contraintes (constraint) et ses décisions (decision).
Règles :
- Uniquement ce que le candidat a dit lui-même. N'invente rien, ne déduis rien.
- Une phrase courte par fait, dans la langue du candidat.`,
} as const satisfies TaskPlaybookSeed;
