/**
 * The `motions` workflow's command line (.github/workflows/motions.yml; docs/ops/motions.md). Each command is a stage
 * of run.ts on the work folder `--work` (default: motions-work):
 *
 *   npm run motions -w @jobhub/motions -- plan --select flagged|all|<id,id> [--fixtures] [--since <ISO date>]
 *   npm run motions -w @jobhub/motions -- narrate
 *   (capture: MOTIONS_WORK=<work> npx playwright test --project=motions)
 *   npm run motions -w @jobhub/motions -- render
 *   npm run motions -w @jobhub/motions -- publish
 *   npm run motions -w @jobhub/motions -- samples
 *
 * `publish` writes summary.md and, on GitHub, the run's summary. It never fails because a motion broke.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readMotionScripts } from "@jobhub/help/motion-scripts-content";
import { bucketFromEnv, readManifest, readPublicManifest } from "./bucket";
import { renderMotion } from "./render";
import { fixturesDir, motionScriptsDir, narrateAll, publishAll, renderAll, writePlan } from "./run";
import { voiceSamples } from "./samples";
import { flaggedScripts, mergedPullBodies, selectMotions } from "./select";
import { runSummary } from "./summary";
import { voiceFromEnv } from "./voice";

/** Where the published motions are read from by anyone. */
function publicUrl(): string {
  return process.env.MOTIONS_PUBLIC_URL ?? "https://media.jobbbox.ai";
}

function option(name: string, args: string[]): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  const work = path.resolve(process.env.INIT_CWD ?? process.cwd(), option("work", args) ?? process.env.MOTIONS_WORK ?? "motions-work");
  switch (command) {
    case "plan": {
      const request = option("select", args) ?? "flagged";
      const scriptsDir = args.includes("--fixtures") ? fixturesDir : motionScriptsDir;
      const bucket = bucketFromEnv();
      const manifest = bucket ? await readManifest(bucket) : await readPublicManifest(publicUrl());
      const flagged =
        request === "flagged" && process.env.GITHUB_REPOSITORY
          ? flaggedScripts(await mergedPullBodies({ repo: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN, since: option("since", args) || null }))
          : [];
      const plan = selectMotions({ request, scripts: readMotionScripts(scriptsDir), scriptsDir, flagged, manifest });
      writePlan(work, plan);
      console.log(`${plan.length} motion(s) to render${flagged.length ? ` (flagged: ${flagged.join(", ")})` : ""}: ${plan.map((motion) => `${motion.id}/${motion.locale}`).join(", ") || "none"}`);
      return;
    }
    case "narrate": {
      const voice = voiceFromEnv();
      console.log(`Voice: ${voice.provider} (${voice.voices.fr}, ${voice.voices.en})${voice.publishable ? "" : ": a draft, never published"}`);
      await narrateAll(work, voice);
      return;
    }
    case "render":
      await renderAll(work, renderMotion);
      return;
    case "publish": {
      const bucket = bucketFromEnv();
      const voice = voiceFromEnv();
      const { outcomes } = await publishAll(work, bucket, new Date(), bucket ? null : await readPublicManifest(publicUrl()));
      const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined;
      const summary = runSummary({ outcomes, voice: `${voice.provider} (${voice.voices.fr} ; ${voice.voices.en})`, publicUrl: bucket?.publicUrl ?? null, runUrl });
      writeFileSync(path.join(work, "summary.md"), summary);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
      console.log(summary);
      return;
    }
    case "samples": {
      const lines = await voiceSamples(path.join(work, "voice-samples"));
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Échantillons de voix\n\n${lines.join("\n") || "Aucune clé de fournisseur : aucun échantillon."}\n`);
      console.log(lines.join("\n") || "No provider key set: no samples.");
      return;
    }
    default:
      throw new Error(`unknown command ${command ?? "(none)"}: plan, narrate, render, publish or samples`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
