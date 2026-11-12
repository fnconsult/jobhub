import { describe, expect, it } from "vitest";
import { snapshotOfSettings } from "../platform-settings/resolver";
import { contentSecurityPolicy, helpMediaOrigin, isoDuration, parseManifest, publishedDurations, publishedVideo, transcriptOfMarkdown, transcriptOfScript, videoDuration } from ".";

const files = (id: string, locale: string) => ({
  video: `${id}/${locale}/0123456789ab/20261102T090000Z/video.mp4`,
  captions: `${id}/${locale}/0123456789ab/20261102T090000Z/captions.vtt`,
  transcript: `${id}/${locale}/0123456789ab/20261102T090000Z/transcript.md`,
  poster: `${id}/${locale}/0123456789ab/20261102T090000Z/poster.jpg`,
});
const entry = (id: string, locale: string, duration = 65.4) => ({ hash: "0123456789ab", duration, renderedAt: "2026-11-02T09:00:00.000Z", voice: "azure/fr-FR-DeniseNeural", files: files(id, locale) });

describe("the Help Centre's media origin (HELP_MEDIA_ORIGIN, #568)", () => {
  it("is https://media.jobbbox.ai by default, and what env or the Back Office set", () => {
    expect(helpMediaOrigin(snapshotOfSettings({}, {}))).toBe("https://media.jobbbox.ai");
    expect(helpMediaOrigin(snapshotOfSettings({ HELP_MEDIA_ORIGIN: "https://media.staging.example/" }, {}))).toBe("https://media.staging.example");
    expect(helpMediaOrigin(snapshotOfSettings({ HELP_MEDIA_ORIGIN: "http://localhost:4567" }, {}))).toBe("http://localhost:4567");
  });

  it("keeps the default over an origin it refuses: plain http elsewhere than this machine, a path, a query", () => {
    for (const refused of ["http://media.example", "https://media.jobbbox.ai/videos", "https://media.jobbbox.ai/?a=1", "media.jobbbox.ai", "javascript:alert(1)"])
      expect(helpMediaOrigin(snapshotOfSettings({ HELP_MEDIA_ORIGIN: refused }, {})), refused).toBe("https://media.jobbbox.ai");
  });

  it("is the only source of media the pages allow", () => {
    expect(contentSecurityPolicy("https://media.jobbbox.ai")).toBe("media-src https://media.jobbbox.ai");
    expect(contentSecurityPolicy("https://media.jobbbox.ai", true)).toBe("media-src https://media.jobbbox.ai; frame-src 'self' https://cal.com https://app.cal.com");
  });
});

describe("the bucket's manifest, as the web app reads it", () => {
  it("gives a script's video in a language, its files on the origin, and its duration", () => {
    const manifest = parseManifest({ motions: { "retrouver-une-candidature": { fr: entry("retrouver-une-candidature", "fr"), en: entry("retrouver-une-candidature", "en", 58) } } });
    expect(publishedVideo(manifest, "retrouver-une-candidature", "fr", "https://media.jobbbox.ai")).toEqual({
      id: "retrouver-une-candidature",
      locale: "fr",
      hash: "0123456789ab",
      duration: 65.4,
      video: "https://media.jobbbox.ai/retrouver-une-candidature/fr/0123456789ab/20261102T090000Z/video.mp4",
      captions: "https://media.jobbbox.ai/retrouver-une-candidature/fr/0123456789ab/20261102T090000Z/captions.vtt",
      transcript: "https://media.jobbbox.ai/retrouver-une-candidature/fr/0123456789ab/20261102T090000Z/transcript.md",
      poster: "https://media.jobbbox.ai/retrouver-une-candidature/fr/0123456789ab/20261102T090000Z/poster.jpg",
    });
    expect(publishedDurations(manifest, "en")).toEqual({ "retrouver-une-candidature": 58 });
  });

  it("has no video for a script not published in that language, nor for an odd entry", () => {
    const manifest = parseManifest({
      motions: {
        "en-francais": { fr: entry("en-francais", "fr") },
        "sans-duree": { fr: { ...entry("sans-duree", "fr"), duration: "65" } },
        "hors-du-bucket": { fr: { ...entry("hors-du-bucket", "fr"), files: { ...files("hors-du-bucket", "fr"), video: "https://ailleurs.example/video.mp4" } } },
        "remonte": { fr: { ...entry("remonte", "fr"), files: { ...files("remonte", "fr"), poster: "../../poster.jpg" } } },
      },
    });
    expect(publishedVideo(manifest, "en-francais", "en", "https://media.jobbbox.ai")).toBeNull();
    expect(publishedVideo(manifest, "en-francais", "fr", "https://media.jobbbox.ai")).not.toBeNull();
    for (const id of ["sans-duree", "hors-du-bucket", "remonte", "absent"]) expect(publishedVideo(manifest, id, "fr", "https://media.jobbbox.ai"), id).toBeNull();
    expect(parseManifest(null)).toEqual({});
    expect(parseManifest({ motions: "non" })).toEqual({});
  });
});

describe("a video's duration and transcript", () => {
  it("reads the duration in minutes and seconds", () => {
    expect(videoDuration(45.2)).toBe("45 s");
    expect(videoDuration(65.4)).toBe("1 min 05 s");
    expect(videoDuration(90)).toBe("1 min 30 s");
    expect(isoDuration(65.4)).toBe("PT1M5S");
    expect(isoDuration(60)).toBe("PT1M");
  });

  it("takes the transcript from the Motion Script, or from the published transcript.md, step by step", () => {
    const steps = [{ title: "Vos candidatures", actions: [], narration: "« Mes candidatures » liste vos **candidatures**.\n\nLa plus récente en haut." }];
    expect(transcriptOfScript({ steps })).toEqual([{ title: "Vos candidatures", paragraphs: ["« Mes candidatures » liste vos candidatures.", "La plus récente en haut."] }]);
    const markdown = "# Retrouver une candidature\n\nTranscription. Voix de synthèse.\n\n## Vos candidatures\n\n« Mes candidatures » liste vos candidatures.\n\n## Une candidature\n\nCliquez sur son intitulé.\n";
    expect(transcriptOfMarkdown(markdown)).toEqual([
      { title: "Vos candidatures", paragraphs: ["« Mes candidatures » liste vos candidatures."] },
      { title: "Une candidature", paragraphs: ["Cliquez sur son intitulé."] },
    ]);
  });
});
