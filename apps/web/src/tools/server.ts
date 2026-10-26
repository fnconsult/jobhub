import type { Tool, ToolCategory } from "@jobhub/shared";
import { sharedPool } from "@/database/pool";
import type { PlatformSettingsSnapshot } from "@/platform-settings/resolver";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getSecretResolver } from "@/provider-secrets/server";
import { getSignInProviders } from "@/sign-in-providers/server";
import { latestToolCalls, toolCalls, toolsOverview, type CalledTool, type ToolCall, type ToolRow, type ToolsState } from "./index";

/**
 * The values in use (Provider Secrets over env), the Platform Settings in use (read now, as
 * Paramètres reads them) and the Sign-in Providers enabled; none without a database. Paramètres' providers are read from it too.
 */
export async function currentState(): Promise<ToolsState & { settings: PlatformSettingsSnapshot }> {
  const env = getSecretResolver().current().env;
  const settings = await getPlatformSettingsResolver().refresh();
  if (!process.env.DATABASE_URL) return { env, signInTypes: [], settings };
  const providers = await getSignInProviders().list();
  return { env, signInTypes: providers.filter((provider) => provider.enabled).map((provider) => provider.type), settings };
}

/** Every Tool, by category, with its status, its settings and its last 30 days' calls, as the Outils page lists them. */
export async function toolsOverviewNow(): Promise<{ category: ToolCategory; rows: ToolRow[] }[]> {
  return toolsOverview(sharedPool(), await currentState(), new Date());
}

/** `tool`'s status and latest calls, as its Outils page shows them. */
export async function toolPage(tool: Tool): Promise<{ row: ToolRow; calls: ToolCall[] }> {
  const overview = await toolsOverviewNow();
  const row = overview.flatMap((group) => group.rows).find((candidate) => candidate.tool.id === tool.id)!;
  return { row, calls: await toolCalls(sharedPool(), tool) };
}

/** Every Tool's `limit` latest calls together, newest first, as the Journal's Outils filter lists them; none without a database. */
export async function latestToolCallsNow(limit: number, options: { ok?: boolean } = {}): Promise<CalledTool[]> {
  if (!process.env.DATABASE_URL) return [];
  return latestToolCalls(sharedPool(), { limit, ...options });
}
