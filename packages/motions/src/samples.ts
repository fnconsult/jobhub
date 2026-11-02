/**
 * Voice samples for choosing the provider by ear (#567): the same narration, in French and in English, read by every
 * candidate voice of every provider whose key is set. The `motions` workflow attaches them to its run (`voice-samples`);
 * the product owner picks one and names it in MOTIONS_VOICE_PROVIDER, MOTIONS_VOICE_FR and MOTIONS_VOICE_EN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HelpLocale } from "@jobhub/help";
import { CANDIDATE_VOICES, configuredProviders, voiceOf, type VoiceProviderId } from "./voice";

/** What every sample says: a Tutorial's step, with an interface label and a number, read slowly. */
export const SAMPLE_TEXT: Record<HelpLocale, string> = {
  fr: "Ouvrez « Mes candidatures », dans le menu à gauche. Cliquez sur l'offre « Responsable comptable » : sa page s'ouvre, avec son statut, « À postuler ». En une minute, votre candidature est prête.",
  en: "Open “My applications”, in the menu on the left. Click the “Accounts manager” offer: its page opens, with its status, “To apply”. In one minute, your application is ready.",
};

export async function voiceSamples(dir: string, env: Record<string, string | undefined> = process.env, providers: VoiceProviderId[] = configuredProviders(env)): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  for (const provider of providers) {
    for (const locale of ["fr", "en"] as const) {
      for (const name of CANDIDATE_VOICES[provider][locale]) {
        const file = `${provider}-${locale}-${name.replace(/[^A-Za-z0-9-]/g, "_")}`;
        try {
          const audio = await voiceOf(provider, { fr: name, en: name }, env).speak(SAMPLE_TEXT[locale], locale);
          writeFileSync(path.join(dir, `${file}.${audio.extension}`), audio.data);
          lines.push(`- ${provider}, ${locale.toUpperCase()}, ${name} : \`${file}.${audio.extension}\``);
        } catch (error) {
          lines.push(`- ${provider}, ${locale.toUpperCase()}, ${name} : ⚠️ ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  const missing = (["elevenlabs", "azure", "google"] as const).filter((provider) => !providers.includes(provider));
  const readme = [
    "## Échantillons de voix",
    "",
    "Même texte, lu par chaque voix candidate. Choisissez à l'oreille, puis réglez MOTIONS_VOICE_PROVIDER, MOTIONS_VOICE_FR et MOTIONS_VOICE_EN (variables du dépôt).",
    "",
    ...lines,
    ...(missing.length ? ["", `Sans clé, donc sans échantillon : ${missing.join(", ")} (docs/ops/motions.md).`] : []),
    "",
  ].join("\n");
  writeFileSync(path.join(dir, "README.md"), readme);
  return lines;
}
