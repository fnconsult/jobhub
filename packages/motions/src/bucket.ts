/**
 * Where the motions are published (ADR-0066): a Scaleway Object Storage bucket in fr-par, served at media.jobbbox.ai.
 * MP4, VTT, transcripts and posters live there, never in git, under `<script>/<langue>/<hash du script>/`, with
 * `manifest.json` at its root naming the version each script shows in each language. A capture that broke leaves its
 * manifest entry as it was: the previous video stays online.
 *
 *   const bucket = bucketFromEnv(process.env);     // Scaleway through the aws CLI, or a folder (MOTIONS_BUCKET_DIR)
 *   const manifest = await readManifest(bucket);
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { HelpLocale } from "@jobhub/help";

/** One script in one language, as published. */
export interface PublishedMotion {
  hash: string;
  /** Seconds. */
  duration: number;
  /** ISO date and time of the render. */
  renderedAt: string;
  /** `<provider>/<voice>`. */
  voice: string;
  /** Bucket keys. */
  files: { video: string; captions: string; transcript: string; poster: string };
}

export interface Manifest {
  motions: Record<string, Partial<Record<HelpLocale, PublishedMotion>>>;
}

export const MANIFEST_KEY = "manifest.json";

export interface Bucket {
  /** What the summary links to: https://media.jobbbox.ai, or the folder. */
  publicUrl: string;
  get(key: string): Promise<string | null>;
  put(key: string, file: string, contentType: string, cacheControl: string): Promise<void>;
}

/** Content types of the published files. */
export const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
};

type Env = Record<string, string | undefined>;

/** The bucket the environment names; null when there is none to publish to (no keys, no folder). */
export function bucketFromEnv(env: Env = process.env): Bucket | null {
  if (env.MOTIONS_BUCKET_DIR) return directoryBucket(env.MOTIONS_BUCKET_DIR);
  if (!env.MOTIONS_S3_ACCESS_KEY || !env.MOTIONS_S3_SECRET_KEY) return null;
  return scalewayBucket({
    name: env.MOTIONS_BUCKET ?? "media.jobbbox.ai",
    endpoint: env.MOTIONS_S3_ENDPOINT ?? "https://s3.fr-par.scw.cloud",
    region: env.MOTIONS_S3_REGION ?? "fr-par",
    accessKey: env.MOTIONS_S3_ACCESS_KEY,
    secretKey: env.MOTIONS_S3_SECRET_KEY,
    publicUrl: env.MOTIONS_PUBLIC_URL ?? "https://media.jobbbox.ai",
  });
}

/** A folder standing for the bucket: a pull request's dry run, and the tests. */
export function directoryBucket(dir: string): Bucket {
  return {
    publicUrl: path.resolve(dir),
    get: (key) => Promise.resolve(existsSync(path.join(dir, key)) ? readFileSync(path.join(dir, key), "utf8") : null),
    put: (key, file) => {
      mkdirSync(path.dirname(path.join(dir, key)), { recursive: true });
      copyFileSync(file, path.join(dir, key));
      return Promise.resolve();
    },
  };
}

/** Scaleway Object Storage (S3 API) through the aws CLI, which GitHub's runners have. Public-read objects. */
export function scalewayBucket(config: { name: string; endpoint: string; region: string; accessKey: string; secretKey: string; publicUrl: string }): Bucket {
  const env = { ...process.env, AWS_ACCESS_KEY_ID: config.accessKey, AWS_SECRET_ACCESS_KEY: config.secretKey, AWS_DEFAULT_REGION: config.region, AWS_EC2_METADATA_DISABLED: "true" };
  const aws = (args: string[]) => spawnSync("aws", ["--endpoint-url", config.endpoint, ...args], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    publicUrl: config.publicUrl,
    get: (key) => {
      const run = aws(["s3", "cp", `s3://${config.name}/${key}`, "-"]);
      if (run.status === 0) return Promise.resolve(run.stdout);
      if (/404|NoSuchKey|does not exist/i.test(run.stderr)) return Promise.resolve(null);
      return Promise.reject(new Error(`reading s3://${config.name}/${key} failed: ${run.stderr.trim()}`));
    },
    put: (key, file, contentType, cacheControl) => {
      const run = aws(["s3", "cp", file, `s3://${config.name}/${key}`, "--content-type", contentType, "--cache-control", cacheControl, "--acl", "public-read"]);
      return run.status === 0 ? Promise.resolve() : Promise.reject(new Error(`publishing ${key} failed: ${run.stderr.trim()}`));
    },
  };
}

export async function readManifest(bucket: Bucket): Promise<Manifest> {
  const text = await bucket.get(MANIFEST_KEY);
  return text ? (JSON.parse(text) as Manifest) : { motions: {} };
}

/** A version's files never change once published (their folder is the script's hash); the manifest changes at each run. */
export const IMMUTABLE = "public, max-age=31536000, immutable";
export const SHORT_LIVED = "public, max-age=60";
