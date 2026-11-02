/**
 * What changed in a `motions` run, for the product owner, in French (the run's summary on GitHub, and summary.md):
 * each motion rendered, published or broken, with its links; a broken capture names its step and says which video stays
 * online. Written for a person who watches the new videos before the Promotion (ADR-0066).
 */
import type { MotionOutcome } from "./run";

const REASONS: Record<MotionOutcome["reason"], string> = {
  flagged: "« Motion à régénérer »",
  changed: "script modifié",
  new: "jamais publiée",
  all: "toutes",
  named: "demandée",
};

export function runSummary(options: { outcomes: readonly MotionOutcome[]; voice: string; publicUrl: string | null; runUrl?: string }): string {
  const { outcomes, voice, publicUrl, runUrl } = options;
  const link = (key: string) => (publicUrl ? `${publicUrl.replace(/\/$/, "")}/${key}` : key);
  const lines = ["## Motions", ""];
  if (outcomes.length === 0) return [...lines, "Aucune motion à régénérer : rien n'a changé.", ""].join("\n");
  const broken = outcomes.filter((outcome) => outcome.status === "broken");
  lines.push(
    `Voix : ${voice}. ${publicUrl ? `Publiées sur ${publicUrl}.` : "Rien n'est publié : les fichiers sont dans l'artefact « motions » du run."}${runUrl ? ` [Run](${runUrl}).` : ""}`,
    "",
    "| Motion | Langue | Pourquoi | Résultat | Durée | Fichiers |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const outcome of outcomes) {
    const files = outcome.published
      ? `[vidéo](${link(outcome.published.files.video)}) · [sous-titres](${link(outcome.published.files.captions)}) · [transcription](${link(outcome.published.files.transcript)}) · [poster](${link(outcome.published.files.poster)})`
      : outcome.status === "rendered"
        ? `artefact \`${outcome.id}/${outcome.locale}/out/\``
        : "";
    const result =
      outcome.status === "published"
        ? `✅ nouvelle vidéo \`${outcome.hash}\`${outcome.previous ? ` (remplace \`${outcome.previous.hash}\`)` : ""}`
        : outcome.status === "rendered"
          ? `🎬 rendue, non publiée`
          : `⚠️ cassée : ${outcome.previous ? `la vidéo \`${outcome.previous.hash}\` reste en ligne` : "aucune vidéo précédente"}`;
    lines.push(`| ${outcome.id} | ${outcome.locale.toUpperCase()} | ${REASONS[outcome.reason]} | ${result} | ${outcome.duration ? `${Math.round(outcome.duration)} s` : ""} | ${files} |`);
  }
  const warnings = [
    ...broken.map((outcome) => `**${outcome.id} (${outcome.locale.toUpperCase()})** : ${STAGE_LABELS[outcome.failure!.stage]} cassée, ${escape(outcome.failure!.error)}`),
    ...outcomes.flatMap((outcome) => outcome.warnings.map((warning) => `**${outcome.id} (${outcome.locale.toUpperCase()})** : ${escape(warning)}`)),
  ];
  if (warnings.length > 0) lines.push("", "### ⚠️ Avertissements", "", ...warnings.map((warning) => `- ${warning}`));
  lines.push("", "La Promotion n'attend pas ces vidéos : une vidéo cassée garde la précédente, et le Tutorial fait foi.", "");
  return lines.join("\n");
}

const STAGE_LABELS = { narrate: "voix", capture: "capture", render: "rendu", publish: "publication" } as const;

function escape(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
