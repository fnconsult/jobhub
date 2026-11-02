/**
 * The Micro-animations (ADR-0066, #569): movements of 2 to 5 s that show a gesture hard to find by reading, played once
 * when the reader clicks « Voir comment ». Drawn in CSS/SVG in the web app (`apps/web/src/micro-animations`), one per id
 * below; this list is what the build checks a Help Article's references against.
 *
 * A Tutorial references one on a numbered step, a FAQ after its answer, by a token at the end of the line:
 *
 *   2. Cliquez sur l'icône de l'extension, puis sur « Épingler ». {{voir-comment:extension-side-panel}}
 *
 * The token never reaches the article's text: the build moves it to the article's `microAnimations`.
 */

/** Every Micro-animation, by id, with how long it plays (between 2 and 5 s). */
export const MICRO_ANIMATIONS = {
  /** Pin the extension in the browser's toolbar, then open its Side Panel (tutorial of #553). */
  "extension-side-panel": { durationMs: 4800 },
  /** Forward a job offer's email to one's Forwarding address (Email intake tutorial of #556). */
  "forward-email": { durationMs: 4800 },
  /** Mon compte, Préférences: the « Taille du texte » slider, from Standard to Grand. */
  "text-size": { durationMs: 3600 },
  /** An Application's status set to « Entretien », and its « Entretiens » part offers « Ajouter l'entretien ». */
  "interview-status": { durationMs: 4400 },
} as const satisfies Record<string, { durationMs: number }>;

export type MicroAnimationId = keyof typeof MICRO_ANIMATIONS;

export const MICRO_ANIMATION_IDS = Object.keys(MICRO_ANIMATIONS) as MicroAnimationId[];

export function isMicroAnimationId(id: string): id is MicroAnimationId {
  return Object.hasOwn(MICRO_ANIMATIONS, id);
}

/**
 * Where a Help Article shows a Micro-animation: beside its numbered step `step` (a Tutorial), or after its answer
 * (`step: null`, a FAQ).
 */
export interface MicroAnimationPlacement {
  id: MicroAnimationId;
  step: number | null;
}

/** A reference at the end of a line: `{{voir-comment:<id>}}`. */
const REFERENCE_AT_END = /[ \t]*\{\{voir-comment:([^}]*)\}\}[ \t]*$/;
const ANY_REFERENCE = /\{\{voir-comment:/;

/**
 * A body's Micro-animation references, taken out of its text. `step` is the numbered step a reference ends, null for
 * one on any other line. `problems` lists a reference not at the end of its line, or naming no Micro-animation.
 */
export function takeMicroAnimations(body: string): { body: string; references: { id: string; step: number | null }[]; problems: string[] } {
  const references: { id: string; step: number | null }[] = [];
  const problems: string[] = [];
  const lines = body.split(/\r?\n/).map((line) => {
    const reference = REFERENCE_AT_END.exec(line);
    if (!reference) {
      if (ANY_REFERENCE.test(line)) problems.push(`a « Voir comment » reference ends its line: ${line.trim()}`);
      return line;
    }
    const text = line.slice(0, reference.index);
    if (ANY_REFERENCE.test(text)) problems.push(`one « Voir comment » reference per line: ${line.trim()}`);
    const id = reference[1]!.trim();
    if (!isMicroAnimationId(id)) problems.push(`no Micro-animation is called ${id}: one of ${MICRO_ANIMATION_IDS.join(", ")}`);
    const step = /^\s*(\d+)\.\s+\S/.exec(text);
    references.push({ id, step: step ? Number(step[1]) : null });
    return text;
  });
  return { body: lines.join("\n"), references, problems };
}
