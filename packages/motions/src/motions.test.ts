import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMotionScript } from "@jobhub/help/motion-scripts-content";
import { directoryBucket, readManifest, readPublicManifest, type Manifest } from "./bucket";
import { narrate, stepDurations, type Narration } from "./narration";
import { framing, zoomAt } from "./remotion/Motion";
import { motionDir, publishAll, writePlan, writeStageError } from "./run";
import { flaggedScripts, mergedPullBodies, selectMotions, type PlannedMotion } from "./select";
import { runSummary } from "./summary";
import { captionCues, INTRO_SECONDS, motionTimeline, webVtt, type Capture } from "./timeline";
import { configuredProviders, voiceFromEnv, voiceOf, type Voice } from "./voice";

const tmp = () => mkdtempSync(path.join(tmpdir(), "motions-"));

const markdown = `---
title: Retrouver une candidature
routes: [/candidatures, /candidatures/[id]]
---
## Vos candidatures
- goto /candidatures
- zoom main

Voici « Mes candidatures ». Chaque ligne est une offre.

## Ouvrir une candidature
- click link « Responsable comptable »

Cliquez sur l'offre.
`;
const script = parseMotionScript("retrouver", "fr", markdown).script;

/** A voice whose every sentence lasts one second per ten characters. */
const fakeVoice = (publishable = true): Voice => ({
  provider: "azure",
  voices: { fr: "fr-FR-DeniseNeural", en: "en-GB-SoniaNeural" },
  publishable,
  speak: (text) => Promise.resolve({ data: Buffer.from(text), extension: "mp3" }),
});
const measure = (file: string) => readFileSync(file, "utf8").length / 10;

describe("voice — the synthetic voice providers", () => {
  const recorded: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    recorded.push({ url, init });
    if (url.includes("googleapis")) return new Response(JSON.stringify({ audioContent: Buffer.from("mp3").toString("base64") }));
    return new Response("mp3");
  }) as unknown as typeof fetch;

  it("calls ElevenLabs, Azure (France Central) and Google (EU endpoint) with their key, the voice and a slow pace", async () => {
    const env = { MOTIONS_ELEVENLABS_API_KEY: "el-key", MOTIONS_AZURE_SPEECH_KEY: "az-key", MOTIONS_GOOGLE_TTS_API_KEY: "g-key" };
    for (const provider of ["elevenlabs", "azure", "google"] as const) {
      const audio = await voiceOf(provider, { fr: provider === "azure" ? "fr-FR-DeniseNeural" : provider === "google" ? "fr-FR-Neural2-F" : "voice-1", en: "x" }, env, fetcher).speak("Cliquez sur « OK » & <c'est> tout.", "fr");
      expect(audio).toEqual({ data: Buffer.from("mp3"), extension: "mp3" });
    }
    expect(recorded[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128");
    expect(recorded[0]!.init.headers).toMatchObject({ "xi-api-key": "el-key" });
    expect(JSON.parse(recorded[0]!.init.body as string)).toMatchObject({ model_id: "eleven_multilingual_v2", language_code: "fr", voice_settings: { speed: 0.92 } });
    expect(recorded[1]!.url).toBe("https://francecentral.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(recorded[1]!.init.body).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="fr-FR"><voice name="fr-FR-DeniseNeural"><prosody rate="-8%">Cliquez sur « OK » &amp; &lt;c&apos;est&gt; tout.</prosody></voice></speak>',
    );
    expect(recorded[2]!.url).toBe("https://eu-texttospeech.googleapis.com/v1/text:synthesize");
    expect(recorded[2]!.init.headers).toMatchObject({ "x-goog-api-key": "g-key" });
    expect(JSON.parse(recorded[2]!.init.body as string)).toMatchObject({ voice: { languageCode: "fr-FR", name: "fr-FR-Neural2-F" }, audioConfig: { speakingRate: 0.92 } });
  });

  it("chooses the provider the environment names, or the first with a key, or the local draft voice", () => {
    expect(voiceFromEnv({ MOTIONS_VOICE_PROVIDER: "azure", MOTIONS_AZURE_SPEECH_KEY: "k", MOTIONS_VOICE_FR: "fr-FR-HenriNeural" })).toMatchObject({
      provider: "azure",
      voices: { fr: "fr-FR-HenriNeural", en: "en-GB-SoniaNeural" },
      publishable: true,
    });
    expect(voiceFromEnv({ MOTIONS_GOOGLE_TTS_API_KEY: "k" }).provider).toBe("google");
    expect(voiceFromEnv({})).toMatchObject({ provider: "espeak", publishable: false });
    expect(() => voiceFromEnv({ MOTIONS_VOICE_PROVIDER: "azure" })).toThrow(/MOTIONS_AZURE_SPEECH_KEY is not set/);
    expect(() => voiceFromEnv({ MOTIONS_VOICE_PROVIDER: "polly" })).toThrow(/MOTIONS_VOICE_PROVIDER must be/);
    expect(configuredProviders({ MOTIONS_ELEVENLABS_API_KEY: "k", MOTIONS_GOOGLE_TTS_API_KEY: "k" })).toEqual(["elevenlabs", "google"]);
  });

  it("never puts the key in an error", async () => {
    const refusing = (async () => new Response("invalid subscription", { status: 401 })) as unknown as typeof fetch;
    const error = await voiceOf("azure", { fr: "fr-FR-DeniseNeural", en: "x" }, { MOTIONS_AZURE_SPEECH_KEY: "secret-key" }, refusing)
      .speak("Bonjour.", "fr")
      .catch((thrown: Error) => thrown);
    expect(String(error)).toContain("Azure Speech answered 401: invalid subscription");
    expect(String(error)).not.toContain("secret-key");
  });
});

describe("narrate — each sentence read on its own", () => {
  it("writes one audio file per sentence and how long each step must stay on screen", async () => {
    const dir = tmp();
    const narration = await narrate(script, fakeVoice(), dir, measure);
    expect(narration.steps[0]!.sentences.map((sentence) => [sentence.text, sentence.file, sentence.start])).toEqual([
      ["Voici « Mes candidatures ».", "audio/0-0.mp3", 0],
      ["Chaque ligne est une offre.", "audio/0-1.mp3", 2.7 + 0.35],
    ]);
    expect(existsSync(path.join(dir, "audio/1-0.mp3"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, "narration.json"), "utf8"))).toEqual(narration);
    // 2.7 s + 0.35 s + 2.7 s, then the 0.8 s after the step; 2 s + 0.8 s.
    expect(stepDurations(narration)).toEqual([6550, 2800]);
    expect(narration).toMatchObject({ provider: "azure", voice: "fr-FR-DeniseNeural", publishable: true });
  });
});

const narration: Narration = {
  provider: "azure",
  voice: "fr-FR-DeniseNeural",
  publishable: true,
  steps: [
    { sentences: [{ text: "Voici « Mes candidatures ».", file: "audio/0-0.mp3", duration: 2, start: 0 }], duration: 2.8 },
    { sentences: [{ text: "Cliquez sur l'offre.", file: "audio/1-0.mp3", duration: 1.5, start: 0 }], duration: 2.3 },
  ],
};
const capture: Capture = {
  video: "capture.webm",
  width: 1280,
  height: 720,
  steps: [
    { start: 400, end: 3400, zoom: { x: 200, y: 100, width: 600, height: 300 } },
    { start: 3400, end: 6000, zoom: null },
  ],
  visited: ["/candidatures", "/candidatures/abc"],
};

describe("motionTimeline and the captions", () => {
  it("places each step, sentence and zoom after the title card, the recording played from the first step", () => {
    const timeline = motionTimeline(script, narration, capture);
    expect(timeline).toMatchObject({
      title: "Retrouver une candidature",
      duration: INTRO_SECONDS + 5.6 + 1.5,
      videoFrom: 0.4,
      steps: [
        { title: "Vos candidatures", at: 3, length: 3 },
        { title: "Ouvrir une candidature", at: 6, length: 2.6, zoom: null },
      ],
      audio: [
        { file: "audio/0-0.mp3", at: 3, duration: 2 },
        { file: "audio/1-0.mp3", at: 6, duration: 1.5 },
      ],
    });
    expect(webVtt(timeline)).toBe(["WEBVTT", "", "1", "00:00:03.000 --> 00:00:05.000", "Voici «\u00a0Mes candidatures\u00a0».", "", "2", "00:00:06.000 --> 00:00:07.500", "Cliquez sur l'offre.", ""].join("\n"));
  });

  it("refuses a capture that did not play every step", () => {
    expect(() => motionTimeline(script, narration, { ...capture, steps: capture.steps.slice(0, 1) })).toThrow(/the capture played 1 steps of 2/);
  });

  it("cuts a long sentence into captions of two lines of 42 characters at most, never inside « … »", () => {
    const sentence = "Cliquez sur « Enregistrer en candidature », en bas du panneau à droite : l'offre rejoint vos candidatures, au statut « À postuler ».";
    const cues = captionCues(sentence, 10, 8);
    expect(cues.length).toBe(2);
    for (const cue of cues) for (const line of cue.text.split("\n")) expect(line.length).toBeLessThanOrEqual(42);
    expect(cues[0]!.start).toBe(10);
    expect(cues.at(-1)!.end).toBe(18);
    expect(cues.map((cue) => cue.text).join(" ")).not.toMatch(/«[ \n]|[ \n]»/);
  });
});

describe("the zoom", () => {
  it("frames the box as large as 1.8× allows, without showing past the capture's edges", () => {
    expect(framing(null, 1280, 720)).toEqual({ scale: 1, x: 0, y: 0 });
    const framed = framing({ x: 1000, y: 600, width: 200, height: 80 }, 1280, 720);
    expect(framed.scale).toBe(1.8);
    expect(framed.x).toBe(1280 - 1280 * 1.8);
    expect(framed.y).toBe(720 - 720 * 1.8);
    expect(framing({ x: 0, y: 0, width: 1280, height: 720 }, 1280, 720).scale).toBe(1);
  });

  it("moves slowly from the previous step's zoom to the current one", () => {
    const steps = [
      { title: "a", at: 3, length: 3, zoom: { x: 200, y: 100, width: 600, height: 300 } },
      { title: "b", at: 6, length: 3, zoom: null },
    ];
    expect(zoomAt({ steps }, 3, 1280, 720).scale).toBe(1);
    expect(zoomAt({ steps }, 5, 1280, 720)).toEqual(framing(steps[0]!.zoom, 1280, 720));
    expect(zoomAt({ steps }, 6.45, 1280, 720).scale).toBeGreaterThan(1);
    expect(zoomAt({ steps }, 7, 1280, 720)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("select — which motions a run renders", () => {
  const scripts = { fr: [script], en: [{ ...script, locale: "en" as const, hash: "en0000000000" }] };
  const published = (hash: string) => ({ hash, duration: 40, renderedAt: "2026-10-30T10:00:00.000Z", voice: "azure/x", files: { video: "", captions: "", transcript: "", poster: "" } });

  it("reads the « Motion à régénérer » lines of pull request bodies", () => {
    expect(flaggedScripts(["Résumé.\n\nMotion à régénérer : retrouver\nMotion à régénérer : `postuler-cv`", null, "motion à régénérer: retrouver"])).toEqual(["retrouver", "postuler-cv"]);
  });

  it("renders the flagged ones, and those never published or whose script changed", () => {
    const select = (manifest: Manifest, flagged: string[] = []) => selectMotions({ request: "flagged", scripts, scriptsDir: "/s", flagged, manifest }).map((motion) => `${motion.locale}:${motion.reason}`);
    expect(select({ motions: {} })).toEqual(["fr:new", "en:new"]);
    expect(select({ motions: { retrouver: { fr: published(script.hash), en: published("old000000000") } } })).toEqual(["en:changed"]);
    expect(select({ motions: { retrouver: { fr: published(script.hash), en: published("en0000000000") } } })).toEqual([]);
    expect(select({ motions: { retrouver: { fr: published(script.hash), en: published("en0000000000") } } }, ["retrouver"])).toEqual(["fr:flagged", "en:flagged"]);
  });

  it("renders all, or the ones named, and refuses an unknown name", () => {
    const manifest = { motions: {} };
    expect(selectMotions({ request: "all", scripts, scriptsDir: "/s", flagged: [], manifest }).map((motion) => motion.reason)).toEqual(["all", "all"]);
    expect(selectMotions({ request: "retrouver", scripts, scriptsDir: "/s", flagged: [], manifest })[0]).toEqual({ id: "retrouver", locale: "fr", hash: script.hash, scriptsDir: "/s", reason: "named" });
    expect(() => selectMotions({ request: "retrouver,inconnu", scripts, scriptsDir: "/s", flagged: [], manifest })).toThrow(/no Motion Script named inconnu/);
  });

  it("compares the last Version's date, with its offset, to GitHub's UTC dates as instants", async () => {
    const fetcher = (async () => new Response(JSON.stringify([{ merged_at: "2026-10-20T12:30:00Z", updated_at: "2026-10-20T12:30:00Z", body: "after the tag" }]))) as unknown as typeof fetch;
    // Tag cut at 12:03 UTC, written 14:03+02:00: as text, 12:30Z would sort before it.
    expect(await mergedPullBodies({ repo: "fnconsult/jobhub", since: "2026-10-20T14:03:11+02:00", fetcher })).toEqual(["after the tag"]);
    await expect(mergedPullBodies({ repo: "x/y", since: "hier", fetcher })).rejects.toThrow(/--since hier is no date/);
  });

  it("lists the bodies of pull requests merged since the last Version", async () => {
    const pulls = [
      { merged_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", body: "Motion à régénérer : retrouver" },
      { merged_at: null, updated_at: "2026-10-31T10:00:00Z", body: "closed, not merged" },
      { merged_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", body: "before the Version" },
    ];
    let asked = "";
    const fetcher = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify(pulls));
    }) as unknown as typeof fetch;
    expect(await mergedPullBodies({ repo: "fnconsult/jobhub", since: "2026-10-25T00:00:00Z", fetcher })).toEqual(["Motion à régénérer : retrouver"]);
    expect(asked).toContain("/repos/fnconsult/jobhub/pulls?state=closed&base=main");
  });
});

describe("publishAll — the bucket and its manifest", () => {
  /** A run of `retrouver` in French (rendered) and in English (whose capture broke). */
  function run(publishable = true) {
    const work = tmp();
    const plan: PlannedMotion[] = [
      { id: "retrouver", locale: "fr", hash: "111111111111", scriptsDir: "/s", reason: "changed" },
      { id: "retrouver", locale: "en", hash: "222222222222", scriptsDir: "/s", reason: "changed" },
    ];
    writePlan(work, plan);
    const fr = motionDir(work, plan[0]!);
    mkdirSync(path.join(fr, "out"), { recursive: true });
    for (const file of ["video.mp4", "captions.vtt", "transcript.md", "poster.jpg"]) writeFileSync(path.join(fr, "out", file), file);
    writeFileSync(path.join(fr, "narration.json"), JSON.stringify({ ...narration, publishable, provider: publishable ? "azure" : "espeak" }));
    writeFileSync(path.join(fr, "render.json"), JSON.stringify({ duration: 42.5, warnings: [] }));
    writeStageError(work, plan[1]!, "capture", new Error('étape 2 « Ouvrir » : click button "Ouvrir": Timeout 10000ms exceeded.'));
    return work;
  }
  const previous = { hash: "000000000000", duration: 40, renderedAt: "2026-10-30T10:00:00.000Z", voice: "azure/en-GB-SoniaNeural", files: { video: "retrouver/en/000000000000/video.mp4", captions: "", transcript: "", poster: "" } };

  it("publishes a rendered motion under <script>/<langue>/<hash>/ and keeps the previous video of a broken one", async () => {
    const bucketDir = tmp();
    writeFileSync(path.join(bucketDir, "manifest.json"), JSON.stringify({ motions: { retrouver: { en: previous } } }));
    const bucket = directoryBucket(bucketDir);
    const { outcomes } = await publishAll(run(), bucket, new Date("2026-11-02T09:00:00Z"));

    expect(readFileSync(path.join(bucketDir, "retrouver/fr/111111111111/20261102T090000Z/video.mp4"), "utf8")).toBe("video.mp4");
    expect(existsSync(path.join(bucketDir, "retrouver/fr/111111111111/20261102T090000Z/captions.vtt"))).toBe(true);
    expect(existsSync(path.join(bucketDir, "retrouver/en/222222222222"))).toBe(false);
    expect(await readManifest(bucket)).toEqual({
      motions: {
        retrouver: {
          en: previous,
          fr: {
            hash: "111111111111",
            duration: 42.5,
            renderedAt: "2026-11-02T09:00:00.000Z",
            voice: "azure/fr-FR-DeniseNeural",
            files: {
              video: "retrouver/fr/111111111111/20261102T090000Z/video.mp4",
              captions: "retrouver/fr/111111111111/20261102T090000Z/captions.vtt",
              transcript: "retrouver/fr/111111111111/20261102T090000Z/transcript.md",
              poster: "retrouver/fr/111111111111/20261102T090000Z/poster.jpg",
            },
          },
        },
      },
    });
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["published", "broken"]);
    // A second render of the same script (a page it films changed) goes to a folder of its own: nothing published changes.
    await publishAll(run(), bucket, new Date("2026-11-09T09:00:00Z"));
    expect(readFileSync(path.join(bucketDir, "retrouver/fr/111111111111/20261102T090000Z/video.mp4"), "utf8")).toBe("video.mp4");
    expect((await readManifest(bucket)).motions.retrouver?.fr?.files.video).toBe("retrouver/fr/111111111111/20261109T090000Z/video.mp4");

    const summary = runSummary({ outcomes, voice: "azure", publicUrl: "https://media.jobbbox.ai" });
    expect(summary).toContain("| retrouver | FR | script modifié | ✅ nouvelle vidéo `111111111111` | 43 s | [vidéo](https://media.jobbbox.ai/retrouver/fr/111111111111/20261102T090000Z/video.mp4)");
    expect(summary).toContain("| retrouver | EN | script modifié | ⚠️ cassée : la vidéo `000000000000` reste en ligne |");
    expect(summary).toContain("### ⚠️ Avertissements");
    expect(summary).toContain('- **retrouver (EN)** : capture cassée, étape 2 « Ouvrir » : click button "Ouvrir": Timeout 10000ms exceeded.');
  });

  it("publishes nothing read by the draft voice, nor without a bucket", async () => {
    const bucketDir = tmp();
    const { outcomes } = await publishAll(run(false), directoryBucket(bucketDir));
    expect(outcomes[0]).toMatchObject({ status: "rendered", warnings: ["lue par la voix de brouillon (espeak) : non publiée"] });
    expect(existsSync(path.join(bucketDir, "retrouver"))).toBe(false);

    const { outcomes: dry, manifest } = await publishAll(run(), null, new Date(), { motions: { retrouver: { en: previous } } });
    expect(dry.map((outcome) => outcome.status)).toEqual(["rendered", "broken"]);
    expect(dry[1]!.previous).toEqual(previous);
    expect(manifest).toBeNull();
    expect(runSummary({ outcomes: dry, voice: "azure", publicUrl: null })).toContain("Rien n'est publié : les fichiers sont dans l'artefact « motions » du run.");
  });

  it("reads the manifest online over HTTPS, or nothing when it cannot", async () => {
    const online = (async (url: string) => new Response(url === "https://media.jobbbox.ai/manifest.json" ? JSON.stringify({ motions: { retrouver: {} } }) : "", { status: url.endsWith("manifest.json") ? 200 : 404 })) as unknown as typeof fetch;
    expect(await readPublicManifest("https://media.jobbbox.ai/", online)).toEqual({ motions: { retrouver: {} } });
    const down = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    expect(await readPublicManifest("https://media.jobbbox.ai", down)).toEqual({ motions: {} });
  });

  it("says when nothing needs rendering", () => {
    expect(runSummary({ outcomes: [], voice: "azure", publicUrl: null })).toContain("Aucune motion à régénérer");
  });
});
