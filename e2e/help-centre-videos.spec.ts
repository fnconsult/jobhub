import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { conversationOf } from "./support/conversation";
import { newAddress } from "./support/mailbox";
import { startServer, type PlanPricesServer } from "./support/plan-prices";

// Issue #568 (ADR-0066): a Tutorial's Explainer Video in the Help Centre, under its text: the native player
// (`preload="none"`, a poster, no autoplay), its captions in the page's language, its duration and its transcript to
// unfold; nothing at all while no video is published; « Voir la vidéo (durée) » on the Coach Panel's card; the
// Content-Security-Policy `media-src` allowing the bucket's origin and nothing else.
//
// In the root-env project, which runs one spec at a time: it writes two fixture Tutorials and their Motion Scripts into
// packages/help, rebuilds @jobhub/help and serves it with `next dev` (a second server on the suite's database, the
// Candidate's session carrying over), its HELP_MEDIA_ORIGIN a local server standing for the Scaleway bucket; then
// restores both. No fixture is ever committed.
test.use({ baseURL: process.env.E2E_WEB_ORIGIN, locale: "fr-FR" });

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const helpDir = path.resolve("packages/help");
const GENERATED = ["articles", "motions", "release-notes", "legal-texts"].map((name) => path.join(helpDir, "src", `${name}.generated.ts`));

const tutorial = (locale: "fr" | "en", title: string, motion: string) =>
  [
    "---",
    "kind: tutorial",
    "audience: candidate",
    "topic: utiliser",
    `title: ${title}`,
    "synonyms: [essaivideo]",
    `motion: ${motion}`,
    "---",
    locale === "fr" ? "1. Ouvrez « Mes candidatures ».\n2. Cliquez sur une candidature.\n" : "1. Open « My applications ».\n2. Click an application.\n",
  ].join("\n");
const script = (locale: "fr" | "en") =>
  locale === "fr"
    ? "---\ntitle: Essai de vidéo\nroutes: [/candidatures]\n---\n## Vos candidatures\n- goto /candidatures\n\n« Mes candidatures » liste vos candidatures, la plus récente en haut.\n"
    : "---\ntitle: Video test\nroutes: [/candidatures]\n---\n## Your applications\n- goto /candidatures\n\n« My applications » lists your applications, the latest first.\n";

const FILES: Record<string, string> = {
  "articles/fr/tutorial-e2e-video.md": tutorial("fr", "Essai de vidéo", "e2e-video"),
  "articles/en/tutorial-e2e-video.md": tutorial("en", "Video test", "e2e-video"),
  "articles/fr/tutorial-e2e-sans-video.md": tutorial("fr", "Essai sans vidéo", "e2e-sans-video"),
  "articles/en/tutorial-e2e-sans-video.md": tutorial("en", "Test without a video", "e2e-sans-video"),
  "motions/fr/e2e-video.md": script("fr"),
  "motions/en/e2e-video.md": script("en"),
  "motions/fr/e2e-sans-video.md": script("fr"),
  "motions/en/e2e-sans-video.md": script("en"),
};

/** The bucket's files of one render: the French one from the script in the repo, the English one from an older text. */
const keys = (locale: "fr" | "en", hash: string) => {
  const at = (file: string) => `e2e-video/${locale}/${hash}/20261102T090000Z/${file}`;
  return { video: at("video.mp4"), captions: at("captions.vtt"), transcript: at("transcript.md"), poster: at("poster.jpg") };
};
const FR_HASH = createHash("sha256").update(script("fr")).digest("hex").slice(0, 12);
const EN_HASH = "0000aaaa1111";
const MANIFEST = {
  motions: {
    "e2e-video": {
      fr: { hash: FR_HASH, duration: 65.4, renderedAt: "2026-11-02T09:00:00.000Z", voice: "azure/fr", files: keys("fr", FR_HASH) },
      en: { hash: EN_HASH, duration: 42, renderedAt: "2026-11-02T09:00:00.000Z", voice: "azure/en", files: keys("en", EN_HASH) },
    },
  },
};
// A 1 × 1 image for the poster.
const POSTER = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const EN_TRANSCRIPT = "# Video test\n\nTranscript. Synthetic voice.\n\n## Your applications, as rendered\n\nThe published transcript of the older render.\n";

/** The local server standing for the Scaleway bucket: what it serves, and every path asked of it. */
function mediaServer(): Promise<{ server: Server; origin: string; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    const key = (request.url ?? "/").split("?")[0]!.slice(1);
    asked.push(key);
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (key === "manifest.json") return void response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(MANIFEST));
    if (key.endsWith("poster.jpg")) return void response.writeHead(200, { "Content-Type": "image/png" }).end(POSTER);
    if (key.endsWith("captions.vtt")) return void response.writeHead(200, { "Content-Type": "text/vtt" }).end("WEBVTT\n\n00:00.000 --> 00:04.000\nVoici « Mes candidatures ».\n");
    if (key === keys("en", EN_HASH).transcript) return void response.writeHead(200, { "Content-Type": "text/markdown" }).end(EN_TRANSCRIPT);
    if (key.endsWith("video.mp4")) return void response.writeHead(200, { "Content-Type": "video/mp4" }).end(Buffer.alloc(64));
    response.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked })));
}

/** What the page asks of the bucket, from the browser. */
function bucketRequests(page: Page, origin: string): string[] {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(origin)) asked.push(new URL(request.url()).pathname.slice(1));
  });
  return asked;
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("Explainer Videos in the Help Centre (#568)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  let server: PlanPricesServer;
  let media: Awaited<ReturnType<typeof mediaServer>>;
  const saved = GENERATED.map((file) => ({ file, text: readFileSync(file, "utf8"), stat: statSync(file) }));

  test.beforeAll(async () => {
    media = await mediaServer();
    for (const [file, text] of Object.entries(FILES)) writeFileSync(path.join(helpDir, file), text);
    const built = spawnSync("npm", ["run", "build", "-w", "@jobhub/help"], { encoding: "utf8" });
    expect(built.status, built.stdout + built.stderr).toBe(0);
    expect(built.stdout).toContain("Motion Scripts: 2 in French and English");
    server = await startServer(568, { HELP_MEDIA_ORIGIN: media.origin }, "dev");
  });
  test.afterAll(async () => {
    await server?.stop();
    media?.server.close();
    for (const file of Object.keys(FILES)) rmSync(path.join(helpDir, file), { force: true });
    // Same content, and the same modification time: the suite's build is not taken for a stale one (stale-build.mjs).
    for (const { file, text, stat } of saved) {
      writeFileSync(file, text);
      utimesSync(file, stat.atime, stat.mtime);
    }
  });

  test("a Tutorial with a published video shows it under its text: poster only before play, then the video and its French captions", async ({ page }) => {
    const asked = bucketRequests(page, media.origin);
    const response = await page.goto(`${server.origin}/aide/utiliser/tutorial-e2e-video`, { timeout: 120_000 });
    // Media only from the bucket's origin, nothing else.
    expect(response!.headers()["content-security-policy"]).toBe(`media-src ${media.origin}`);

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("Essai de vidéo");
    const section = main.getByRole("region", { name: fr.helpCentre.video.title });
    await expect(section).toBeVisible();
    // Under the Tutorial's text, which reads complete without it.
    const order = await main.evaluate((root) => {
      const steps = root.querySelector(".help-centre__body ol");
      const video = root.querySelector("#video");
      return steps && video ? steps.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    expect(order).toBeTruthy();

    const video = section.locator("video");
    await expect(video).toHaveAttribute("controls", "");
    await expect(video).toHaveAttribute("preload", "none");
    await expect(video).not.toHaveAttribute("autoplay");
    await expect(video).toHaveAttribute("poster", `${media.origin}/${keys("fr", FR_HASH).poster}`);
    await expect(section.locator("source")).toHaveAttribute("src", `${media.origin}/${keys("fr", FR_HASH).video}`);
    await expect(section.getByText("1 min 05 s")).toBeVisible();
    await expect(section.locator("time")).toHaveAttribute("datetime", "PT1M5S");
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);

    // The transcript, folded, from the Motion Script the video was rendered from: « Voix de synthèse ».
    await section.getByText(fr.helpCentre.video.transcript).click();
    await expect(section.getByText(fr.helpCentre.video.syntheticVoice)).toBeVisible();
    await expect(section.getByRole("heading", { level: 3, name: "Vos candidatures" })).toBeVisible();
    await expect(section.getByText("« Mes candidatures » liste vos candidatures, la plus récente en haut.")).toBeVisible();

    await expectNoAxeViolations(page);

    // Nothing but the poster before play.
    await page.waitForTimeout(1_000);
    expect(asked.filter((key) => !key.endsWith("poster.jpg"))).toEqual([]);

    // Play: the video, and the captions in the page's language, shown.
    await video.evaluate((element: HTMLVideoElement) => void element.play().catch(() => {}));
    await expect.poll(() => asked.filter((key) => key.endsWith("video.mp4")).length).toBeGreaterThan(0);
    await expect.poll(() => asked).toContain(keys("fr", FR_HASH).captions);
    const tracks = await video.evaluate((element: HTMLVideoElement) => [...element.textTracks].map((track) => ({ kind: track.kind, language: track.language, label: track.label, mode: track.mode })));
    expect(tracks).toEqual([{ kind: "captions", language: "fr", label: fr.helpCentre.video.captions.fr, mode: "showing" }]);
  });

  test("in English, the English video, its captions and the transcript published with it", async ({ page }) => {
    const asked = bucketRequests(page, media.origin);
    await page.goto(`${server.origin}/en/aide/utiliser/tutorial-e2e-video`, { timeout: 120_000 });
    const section = page.getByRole("main").getByRole("region", { name: en.helpCentre.video.title });
    await expect(section.locator("source")).toHaveAttribute("src", `${media.origin}/${keys("en", EN_HASH).video}`);
    await expect(section.getByText("42 s")).toBeVisible();
    // Rendered from an older text than the repo's: the transcript is the one published with the video.
    await section.getByText(en.helpCentre.video.transcript).click();
    await expect(section.getByRole("heading", { level: 3, name: "Your applications, as rendered" })).toBeVisible();
    await expect(section.getByText("The published transcript of the older render.")).toBeVisible();
    await expectNoAxeViolations(page);
    await section.locator("video").evaluate((element: HTMLVideoElement) => void element.play().catch(() => {}));
    await expect.poll(() => asked).toContain(keys("en", EN_HASH).captions);
    const languages = await section.locator("video").evaluate((element: HTMLVideoElement) => [...element.textTracks].map((track) => `${track.language} ${track.label} ${track.mode}`));
    expect(languages).toEqual([`en ${en.helpCentre.video.captions.en} showing`]);
  });

  test("a Tutorial whose video is not published reads without a player, and asks nothing of the bucket", async ({ page }) => {
    const asked = bucketRequests(page, media.origin);
    await page.goto(`${server.origin}/aide/utiliser/tutorial-e2e-sans-video`, { timeout: 120_000 });
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("Essai sans vidéo");
    await expect(main.getByRole("listitem").first()).toBeVisible();
    await expect(main.locator("video")).toHaveCount(0);
    await expect(main.getByRole("region", { name: fr.helpCentre.video.title })).toHaveCount(0);
    await expect(main.getByText(fr.helpCentre.video.transcript)).toHaveCount(0);
    expect(asked).toEqual([]);
  });

  test("the Coach Panel's card of the Tutorial says « Voir la vidéo (durée) » and opens it in the Help Centre, playing nothing", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("help-centre-videos"));
    const asked = bucketRequests(page, media.origin);
    // The home page's conversation, on this spec's server.
    await page.goto(`${server.origin}/`, { timeout: 120_000 });
    const panel = conversationOf(page);
    await expect(panel).toBeVisible();
    await panel.getByLabel(fr.coachPanel.messageLabel).fill("essaivideo");
    await panel.getByRole("list", { name: fr.coachPanel.help.suggestions }).getByRole("button", { name: "Essai de vidéo" }).click();
    const card = page.getByRole("complementary", { name: "Essai de vidéo" });
    const link = card.getByRole("link", { name: /^Voir la vidéo \(1 min 05 s\)/ });
    await expect(link).toHaveText("Voir la vidéo (1 min 05 s)");
    await expect(card.locator("video")).toHaveCount(0);
    expect(asked).toEqual([]);
    await link.click();
    await expect(page).toHaveURL(`${server.origin}/aide/utiliser/tutorial-e2e-video#video`);
    await expect(page.getByRole("region", { name: fr.helpCentre.video.title }).locator("video")).toBeVisible();

    // A Tutorial without a published video: no link.
    await page.goto(`${server.origin}/`);
    await expect(panel).toBeVisible();
    await panel.getByLabel(fr.coachPanel.messageLabel).fill("essaivideo");
    await panel.getByRole("list", { name: fr.coachPanel.help.suggestions }).getByRole("button", { name: "Essai sans vidéo" }).click();
    const other = page.getByRole("complementary", { name: "Essai sans vidéo" });
    await expect(other.getByRole("link", { name: fr.coachPanel.help.openInHelpCentre })).toBeVisible();
    await expect(other.getByRole("link", { name: /^Voir la vidéo/ })).toHaveCount(0);
  });
});
