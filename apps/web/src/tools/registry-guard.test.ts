/**
 * The guard on the Tools (#233): every provider a call is recorded for, in `ai_usage` or in
 * `external_api_usage`, anywhere in the code, is a registered Tool. Adding a call to an
 * unregistered tool fails here (and, for `recordingFetch` and `recordingClient`, at type-check).
 * And every Platform Setting tied to a provider is a setting of a Tool (#304).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PROVIDER_IDS, TEXT_TASKS } from "@jobhub/ai";
import { externalApiProvidersOf, TOOLS, type Tool } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { CONTACT_PROVIDERS } from "../enriched-contacts/providers/types";
import { ENV_ONLY_SETTINGS, PLATFORM_SETTINGS, platformSetting } from "../platform-settings/catalog";
import { PROVIDER_SECRETS } from "../provider-secrets/catalog";

/** The Tools, each with the settings it may name. */
const tools = TOOLS as readonly Tool[];

const ROOT = new URL("../../../../", import.meta.url).pathname;

const registered = (table: "ai_usage" | "external_api_usage") =>
  table === "external_api_usage" ? TOOLS.flatMap((tool) => externalApiProvidersOf(tool)) : TOOLS.flatMap((tool) => (tool.usage?.table === table ? [tool.usage.provider as string] : []));

/** Every source file of the apps and packages, tests left out. */
function sourceFiles(): string[] {
  return ["apps", "packages"].flatMap((top) =>
    readdirSync(join(ROOT, top)).flatMap((workspace) => {
      const src = join(ROOT, top, workspace, "src");
      try {
        return (readdirSync(src, { recursive: true }) as string[])
          .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes("node_modules"))
          .map((file) => join(src, file));
      } catch {
        return [];
      }
    }),
  );
}

/**
 * The provider ids a source records external API calls for: in a file calling `recordingFetch` or
 * `recordingClient`, every `provider: "..."` and every `[/host/, "provider"]` pair (a host-to-provider table).
 */
function recordedProviderIds(source: string): string[] {
  if (!/\brecording(Fetch|Client)\(/.test(source)) return [];
  const literals = [...source.matchAll(/provider:\s*"([^"]+)"/g), ...source.matchAll(/\/,\s*"([^"]+)"\s*\]/g)];
  return literals.map((match) => match[1]!);
}

describe("the guard on the Tools", () => {
  it("reads the providers a file records calls for, and none from a file that records none", () => {
    expect(
      recordedProviderIds(`const fetch = recordingFetch(globalThis.fetch, log, { provider: "acme_api" });
        const BOARDS = [[/(^|\\.)acme\\.io$/, "acme_board"]];`),
    ).toEqual(["acme_api", "acme_board"]);
    expect(recordedProviderIds(`const sdk = recordingClient(new Acme(key), log, { provider: "acme_sdk" });`)).toEqual(["acme_sdk"]);
    expect(recordedProviderIds(`const route = { provider: "mistral" };`)).toEqual([]);
  });

  it("finds every external API provider recorded in the code among the Tools", () => {
    const found = sourceFiles().flatMap((file) => recordedProviderIds(readFileSync(file, "utf8")).map((provider) => ({ provider, file: relative(ROOT, file) })));
    // The scan sees the calls of today: France Travail (web and worker), the French register, the job boards and other sites'
    // pages, Stripe, Brevo (API and SMTP) and OIDC discovery (#234).
    expect(found.map(({ provider }) => provider)).toEqual(
      expect.arrayContaining(["france_travail", "recherche_entreprises", "greenhouse", "lever", "ashby", "apec", "job_site", "stripe", "brevo", "brevo_smtp", "oidc"]),
    );
    const external = registered("external_api_usage");
    expect(found.filter(({ provider }) => !external.includes(provider))).toEqual([]);
  });

  it("finds every contact enrichment provider, recorded by its id, among the Tools", () => {
    const external = registered("external_api_usage");
    expect(CONTACT_PROVIDERS.filter((provider) => !external.includes(provider))).toEqual([]);
  });

  it("finds every AI provider, recorded in ai_usage, among the Tools", () => {
    const ai = registered("ai_usage");
    expect(PROVIDER_IDS.filter((provider) => !ai.includes(provider))).toEqual([]);
  });

  it("finds every Provider Secret among the keys of a Tool", () => {
    const keys = TOOLS.flatMap((tool) => tool.keys as readonly string[]);
    expect(PROVIDER_SECRETS.map((secret) => secret.name).filter((name) => !keys.includes(name))).toEqual([]);
  });

  it("finds every setting a Tool names on Paramètres: a Platform Setting, or one env holds that Paramètres shows read-only", () => {
    const shownReadOnly = (name: string) => (ENV_ONLY_SETTINGS as Record<string, { kind: string }>)[name]?.kind === "read_only";
    const unknown = tools.flatMap((tool) => (tool.settings ?? []).filter(({ name }) => !platformSetting(name) && !shownReadOnly(name)).map(({ name }) => `${tool.id}: ${name}`));
    expect(unknown).toEqual([]);
  });

  it("finds every Platform Setting tied to a provider among the settings of a Tool", () => {
    // Tied to no provider: which provider and model each text task uses (any of the AI models; the web search's
    // are its providers'), the Job Digest's thresholds, the extension's store page, and how a Job Search's queries are
    // worded, its Target Companies visited and its monthly web search spend alerted (#402), and the EUR/USD rate (#403).
    const taskRouting = Object.keys(TEXT_TASKS).flatMap((task) => [`AI_${task.toUpperCase()}_PROVIDER`, `AI_${task.toUpperCase()}_MODEL`]);
    const discoveryWide = ["JOB_DISCOVERY_TITLES_PER_LANGUAGE", "JOB_DISCOVERY_QUERY_LANGUAGES", "JOB_DISCOVERY_TARGET_COMPANIES_PER_RUN", "JOB_DISCOVERY_COMPANY_REVISIT_DAYS", "WEB_SEARCH_MONTHLY_ALERT_EUR", "EUR_PER_USD"];
    const tiedToNoProvider = (name: string) => taskRouting.includes(name) || name.startsWith("JOB_DIGEST_") || name === "EXTENSION_STORE_URL" || discoveryWide.includes(name);
    const attached = new Set(tools.flatMap((tool) => (tool.settings ?? []).map(({ name }) => name)));
    expect(PLATFORM_SETTINGS.map(({ name }) => name).filter((name) => !tiedToNoProvider(name) && !attached.has(name))).toEqual([]);
  });
});
