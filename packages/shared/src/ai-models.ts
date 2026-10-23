/**
 * The model catalogue AI Activity names models by (#314, #320): for people, not by their ids.
 *
 *   describeModel("anthropic.claude-opus-5")   { name: "Claude Opus 5", provider: "Anthropic" }
 *   describeModel("basic", "tavily")           a web search: named for its provider, « Tavily »
 *   whereItRan("bedrock eu-north-1")           { fr: "AWS Bedrock · UE (Stockholm)", en: "AWS Bedrock · EU (Stockholm)" }
 *
 * A model or endpoint not in it shows raw. A region is said to be in the EU only where it is established
 * (ADR-0007), as the Tools say it (tools.ts).
 */
import type { Translated } from "./tools";

/** Models by their id, without the endpoint's prefix (`anthropic.`, `eu.`) or a version's date. */
const MODELS: Record<string, { name: string; provider: string }> = {
  "claude-opus-5-5": { name: "Claude Opus 5.5", provider: "Anthropic" },
  "claude-sonnet-5-5": { name: "Claude Sonnet 5.5", provider: "Anthropic" },
  "claude-haiku-5-5": { name: "Claude Haiku 5.5", provider: "Anthropic" },
  "claude-opus-5": { name: "Claude Opus 5", provider: "Anthropic" },
  "claude-sonnet-5": { name: "Claude Sonnet 5", provider: "Anthropic" },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5", provider: "Anthropic" },
  "mistral-large": { name: "Mistral Large", provider: "Mistral AI" },
  "mistral-medium": { name: "Mistral Medium", provider: "Mistral AI" },
  "mistral-medium-3-5": { name: "Mistral Medium 3.5", provider: "Mistral AI" },
  "mistral-small": { name: "Mistral Small", provider: "Mistral AI" },
  "gpt-5": { name: "GPT-5", provider: "OpenAI" },
  "gpt-5-mini": { name: "GPT-5 mini", provider: "OpenAI" },
  "gpt-5-nano": { name: "GPT-5 nano", provider: "OpenAI" },
};

/** Web-search providers, whose "model" is a preset or a depth: named for the provider. */
const SEARCH_PROVIDERS: Record<string, string> = { perplexity: "Perplexity", brave: "Brave Search", tavily: "Tavily", linkup: "Linkup" };

/** A model's catalogue id: its endpoint's prefix (`eu.anthropic.`), its version (`-v1:0`, `@20260901`, `-20261001`, `-latest`) left out. */
function catalogueId(model: string): string {
  return model
    .toLowerCase()
    .replace(/^(eu|us|apac|global)\./, "")
    .replace(/^anthropic\./, "")
    .replace(/-v\d+(:\d+)?$/, "")
    .replace(/@\d+$/, "")
    .replace(/-(latest|\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/, "");
}

/** The model named for people, with who makes it; an unknown model raw, with no provider. A web search's is its provider's name. */
export function describeModel(model: string, provider?: string): { name: string; provider: string | null } {
  const search = provider ? SEARCH_PROVIDERS[provider] : undefined;
  if (search) return { name: search, provider: search };
  return MODELS[catalogueId(model)] ?? { name: model, provider: null };
}

type Residency = "eu" | "outside_eu";

const RESIDENCY: Record<Residency, Translated> = { eu: { fr: "UE", en: "EU" }, outside_eu: { fr: "hors UE", en: "outside the EU" } };

/** A cloud region: where it is, and whether it is in the EU. */
interface Region {
  residency: Residency;
  place?: Translated;
}
const city = (residency: Residency, fr: string, en = fr): Region => ({ residency, place: { fr, en } });

const BEDROCK_REGIONS: Record<string, Region> = {
  "eu-north-1": city("eu", "Stockholm"),
  "eu-west-1": city("eu", "Irlande", "Ireland"),
  "eu-west-3": city("eu", "Paris"),
  "eu-central-1": city("eu", "Francfort", "Frankfurt"),
  "eu-south-1": city("eu", "Milan"),
  "eu-south-2": city("eu", "Espagne", "Spain"),
  "eu-west-2": city("outside_eu", "Londres", "London"),
  "eu-central-2": city("outside_eu", "Zurich"),
  "us-east-1": city("outside_eu", "Virginie", "Virginia"),
  "us-east-2": city("outside_eu", "Ohio"),
  "us-west-2": city("outside_eu", "Oregon"),
};

const VERTEX_REGIONS: Record<string, Region> = {
  eu: { residency: "eu" },
  "europe-west1": city("eu", "Belgique", "Belgium"),
  "europe-west3": city("eu", "Francfort", "Frankfurt"),
  "europe-west4": city("eu", "Pays-Bas", "Netherlands"),
  "europe-west8": city("eu", "Milan"),
  "europe-west9": city("eu", "Paris"),
  "europe-north1": city("eu", "Finlande", "Finland"),
  "europe-southwest1": city("eu", "Madrid"),
  "europe-west2": city("outside_eu", "Londres", "London"),
  "us-central1": city("outside_eu", "Iowa"),
  "us-east5": city("outside_eu", "Ohio"),
};

/** Endpoints that are one host, where it runs. */
const HOSTS: Record<string, { platform: Translated; residency: Residency }> = {
  "api.anthropic.com": { platform: { fr: "API Anthropic", en: "Anthropic API" }, residency: "outside_eu" },
  "api.mistral.ai": { platform: { fr: "Mistral AI", en: "Mistral AI" }, residency: "eu" },
  "eu.api.openai.com": { platform: { fr: "OpenAI", en: "OpenAI" }, residency: "eu" },
  "api.openai.com": { platform: { fr: "OpenAI", en: "OpenAI" }, residency: "outside_eu" },
  "api.perplexity.ai": { platform: { fr: "Perplexity", en: "Perplexity" }, residency: "outside_eu" },
  "api.search.brave.com": { platform: { fr: "Brave Search", en: "Brave Search" }, residency: "outside_eu" },
  "api.tavily.com": { platform: { fr: "Tavily", en: "Tavily" }, residency: "outside_eu" },
  "api.linkup.so": { platform: { fr: "Linkup", en: "Linkup" }, residency: "outside_eu" },
};

/** Endpoints named by a platform and a region, e.g. "bedrock eu-north-1". */
const PLATFORMS: Record<string, { name: string; regions: Record<string, Region> }> = {
  bedrock: { name: "AWS Bedrock", regions: BEDROCK_REGIONS },
  vertex: { name: "Google Vertex AI", regions: VERTEX_REGIONS },
};

/** Where an endpoint runs, in words, e.g. « AWS Bedrock · UE (Stockholm) »; an unknown one raw. */
export function whereItRan(endpoint: string): Translated {
  const host = HOSTS[endpoint];
  if (host) return { fr: `${host.platform.fr} · ${RESIDENCY[host.residency].fr}`, en: `${host.platform.en} · ${RESIDENCY[host.residency].en}` };
  const [kind = "", regionId = ""] = endpoint.split(" ");
  const platform = PLATFORMS[kind];
  if (!platform || !regionId) return { fr: endpoint, en: endpoint };
  const region = platform.regions[regionId];
  if (!region) return { fr: `${platform.name} · ${regionId}`, en: `${platform.name} · ${regionId}` };
  const words = (language: keyof Translated) => `${platform.name} · ${RESIDENCY[region.residency][language]}${region.place ? ` (${region.place[language]})` : ""}`;
  return { fr: words("fr"), en: words("en") };
}
