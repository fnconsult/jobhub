/**
 * The synthetic voice that reads a Motion Script's narration (ADR-0066). A third-party speech-synthesis provider with a
 * large catalogue of French and English voices, chosen by ear by the product owner from the samples the `motions`
 * workflow renders (`voice-samples`). The scripts hold demo data only: the key is a CI secret, neither a Tool nor a
 * Recipient. No language model is called anywhere here: the narration is the reviewed script, read as written.
 *
 *   const voice = voiceFromEnv(process.env);     // MOTIONS_VOICE_PROVIDER, its key, MOTIONS_VOICE_FR / _EN
 *   const audio = await voice.speak("Cliquez sur « Enregistrer ».", "fr"); // { data, extension }
 *
 * `espeak-ng` (local, robotic) stands in when no provider key is set: a draft for pull requests, never published.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HelpLocale } from "@jobhub/help";

export interface SpokenAudio {
  data: Buffer;
  extension: "mp3" | "wav";
}

export interface Voice {
  provider: VoiceProviderId;
  /** The voice's name at its provider, per language. */
  voices: Record<HelpLocale, string>;
  /** Whether its videos may be published: false for the local draft voice. */
  publishable: boolean;
  speak(text: string, locale: HelpLocale): Promise<SpokenAudio>;
}

export const VOICE_PROVIDERS = ["elevenlabs", "azure", "google", "espeak"] as const;
export type VoiceProviderId = (typeof VOICE_PROVIDERS)[number];

/** The secret each provider reads its key from (GitHub Actions secrets of the `motions` workflow). */
export const VOICE_KEYS: Record<Exclude<VoiceProviderId, "espeak">, string> = {
  elevenlabs: "MOTIONS_ELEVENLABS_API_KEY",
  azure: "MOTIONS_AZURE_SPEECH_KEY",
  google: "MOTIONS_GOOGLE_TTS_API_KEY",
};

/**
 * Voices offered for the comparison, per provider and language: neutral, imitating no one (AI Act art. 50(4)). The first
 * of each list is the default until the product owner names one (MOTIONS_VOICE_FR, MOTIONS_VOICE_EN).
 */
export const CANDIDATE_VOICES: Record<VoiceProviderId, Record<HelpLocale, string[]>> = {
  // Premade voices of the multilingual model, which reads French and English.
  elevenlabs: { fr: ["XB0fDUnXU5powFXDhCwa", "ThT5KcBeYPX3keUQqHPh"], en: ["XB0fDUnXU5powFXDhCwa", "pFZP5JQG7iQjIQuC4Bku"] },
  azure: { fr: ["fr-FR-DeniseNeural", "fr-FR-HenriNeural", "fr-FR-VivienneMultilingualNeural"], en: ["en-GB-SoniaNeural", "en-US-AvaMultilingualNeural", "en-GB-RyanNeural"] },
  google: { fr: ["fr-FR-Neural2-F", "fr-FR-Neural2-G", "fr-FR-Chirp3-HD-Aoede"], en: ["en-GB-Neural2-C", "en-US-Neural2-F", "en-GB-Chirp3-HD-Aoede"] },
  espeak: { fr: ["fr"], en: ["en-gb"] },
};

/** A slow, steady pace for a 40+ audience (docs/research/issue-499.md §6). */
const PACE = 0.92;

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

/** The voice the environment configures, or the local draft voice when no key is set. */
export function voiceFromEnv(env: Env = process.env, fetcher: Fetch = fetch): Voice {
  const named = env.MOTIONS_VOICE_PROVIDER as VoiceProviderId | undefined;
  if (named && !(VOICE_PROVIDERS as readonly string[]).includes(named)) throw new Error(`MOTIONS_VOICE_PROVIDER must be ${VOICE_PROVIDERS.join(", ")}`);
  const provider = named ?? (Object.keys(VOICE_KEYS) as (keyof typeof VOICE_KEYS)[]).find((id) => env[VOICE_KEYS[id]]) ?? "espeak";
  const voices = { fr: env.MOTIONS_VOICE_FR || CANDIDATE_VOICES[provider].fr[0]!, en: env.MOTIONS_VOICE_EN || CANDIDATE_VOICES[provider].en[0]! };
  return voiceOf(provider, voices, env, fetcher);
}

/** The voice `provider` with `voices`; throws when its key is missing. */
export function voiceOf(provider: VoiceProviderId, voices: Record<HelpLocale, string>, env: Env = process.env, fetcher: Fetch = fetch): Voice {
  if (provider === "espeak") return { provider, voices, publishable: false, speak: (text, locale) => Promise.resolve(espeak(text, voices[locale])) };
  const key = env[VOICE_KEYS[provider]];
  if (!key) throw new Error(`${VOICE_KEYS[provider]} is not set: the ${provider} voice needs its key (a secret of the motions workflow)`);
  const speak = { elevenlabs: elevenLabs, azure, google }[provider];
  return { provider, voices, publishable: true, speak: (text, locale) => speak(fetcher, key, text, locale, voices[locale], env) };
}

/** The providers whose key is set: those the voice samples compare. */
export function configuredProviders(env: Env = process.env): VoiceProviderId[] {
  return (Object.keys(VOICE_KEYS) as (keyof typeof VOICE_KEYS)[]).filter((id) => env[VOICE_KEYS[id]]);
}

async function answer(response: Response, provider: string): Promise<Buffer> {
  // The key is never part of an error: only the status and the provider's own message.
  if (!response.ok) throw new Error(`${provider} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return Buffer.from(await response.arrayBuffer());
}

/** ElevenLabs, multilingual model. `MOTIONS_ELEVENLABS_URL` may name its EU data-residency endpoint. */
async function elevenLabs(fetcher: Fetch, key: string, text: string, locale: HelpLocale, voice: string, env: Env): Promise<SpokenAudio> {
  const base = env.MOTIONS_ELEVENLABS_URL ?? "https://api.elevenlabs.io";
  const response = await fetcher(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", language_code: locale, voice_settings: { stability: 0.6, similarity_boost: 0.75, speed: PACE } }),
  });
  return { data: await answer(response, "ElevenLabs"), extension: "mp3" };
}

/** Azure AI Speech, in `MOTIONS_AZURE_SPEECH_REGION` (France Central by default). */
async function azure(fetcher: Fetch, key: string, text: string, locale: HelpLocale, voice: string, env: Env): Promise<SpokenAudio> {
  const region = env.MOTIONS_AZURE_SPEECH_REGION ?? "francecentral";
  const lang = voice.slice(0, 5);
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${Math.round((PACE - 1) * 100)}%">${escapeXml(text)}</prosody></voice></speak>`;
  const response = await fetcher(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "content-type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3", "user-agent": "jobbbox-motions" },
    body: ssml,
  });
  void locale;
  return { data: await answer(response, "Azure Speech"), extension: "mp3" };
}

/** Google Cloud Text-to-Speech, on its EU endpoint. */
async function google(fetcher: Fetch, key: string, text: string, locale: HelpLocale, voice: string, env: Env): Promise<SpokenAudio> {
  const base = env.MOTIONS_GOOGLE_TTS_URL ?? "https://eu-texttospeech.googleapis.com";
  const response = await fetcher(`${base}/v1/text:synthesize`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ input: { text }, voice: { languageCode: voice.slice(0, 5), name: voice }, audioConfig: { audioEncoding: "MP3", speakingRate: PACE } }),
  });
  void locale;
  const body = JSON.parse((await answer(response, "Google Text-to-Speech")).toString("utf8")) as { audioContent?: string };
  if (!body.audioContent) throw new Error("Google Text-to-Speech answered no audio");
  return { data: Buffer.from(body.audioContent, "base64"), extension: "mp3" };
}

function espeak(text: string, voice: string): SpokenAudio {
  const dir = mkdtempSync(path.join(tmpdir(), "motions-espeak-"));
  try {
    const file = path.join(dir, "out.wav");
    const run = spawnSync("espeak-ng", ["-v", voice, "-s", "140", "-w", file, text], { encoding: "utf8" });
    if (run.error || run.status !== 0) throw new Error(`espeak-ng failed (install it: apt-get install espeak-ng): ${run.error?.message ?? run.stderr}`);
    return { data: readFileSync(file), extension: "wav" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);
}
