import type { PrivacyPolicyCoverage } from "@jobhub/help";
import { toolById, type Tool } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { BackOfficeChange } from "../admin/back-office";
import { snapshotOfSettings } from "../platform-settings/resolver";
import { toolStatus, type ToolsState } from "./index";
import { switchingOn, uncoveredRecipient } from "./recipients";

const tool = (id: string): Tool => toolById(id)!;
const stateOf = (env: Record<string, string> = {}, signInTypes: string[] = []): ToolsState => ({ env, signInTypes, settings: snapshotOfSettings(env, {}) });

/** No privacy policy in effect yet: it names no recipient. */
const NO_POLICY: PrivacyPolicyCoverage = { version: null, recipientsOutsideEu: [] };
const policyNaming = (...recipientsOutsideEu: string[]): PrivacyPolicyCoverage => ({ version: "2026-12-01", recipientsOutsideEu });

/** Lusha chosen with its DPA signed: on as soon as its key is saved. */
const LUSHA_CHOSEN = { CONTACT_ENRICHMENT_PROVIDER: "lusha", CONTACT_ENRICHMENT_DPA_SIGNED: "true" };

/** A Paramètres change from `before` to `after`, under `policy`: what `switchingOn` returns, and the Audit lines it wrote. */
async function change(before: ToolsState, after: ToolsState, policy: PrivacyPolicyCoverage = NO_POLICY) {
  const recorded: BackOfficeChange[] = [];
  let current = before;
  const done = await switchingOn({ state: async () => current, policy: () => policy, record: async (entries) => void recorded.push(...entries) }, async () => {
    current = after;
    return "saved";
  });
  return { ...done, ids: done.uncovered.map((each) => each.id), recorded };
}

describe("switchingOn — a Paramètres change that switches on a recipient outside the EU (#548, ADR-0064)", () => {
  it("is made all the same, returns the Tool the privacy policy in effect does not name, and writes its Back Office Audit line", async () => {
    const { result, ids, recorded } = await change(stateOf(LUSHA_CHOSEN), stateOf({ ...LUSHA_CHOSEN, LUSHA_API_KEY: "key" }), NO_POLICY);

    expect(result).toBe("saved");
    expect(ids).toEqual(["lusha"]);
    expect(recorded).toEqual([
      { section: "recipients_outside_eu", target: "lusha", action: "switched_on", before: null, after: { residency: "outside_eu", privacyPolicy: null, coverage: "uncovered" } },
    ]);
  });

  it("names the privacy policy version in effect, and counts a residency not established as outside the EU", async () => {
    const kaspr = { CONTACT_ENRICHMENT_PROVIDER: "kaspr", CONTACT_ENRICHMENT_DPA_SIGNED: "true" };
    const { ids, recorded } = await change(stateOf(kaspr), stateOf({ ...kaspr, KASPR_API_KEY: "key" }), policyNaming("lusha"));

    expect(ids).toEqual(["kaspr"]);
    expect(recorded).toEqual([
      { section: "recipients_outside_eu", target: "kaspr", action: "switched_on", before: null, after: { residency: "unknown", privacyPolicy: "2026-12-01", coverage: "uncovered" } },
    ]);
  });

  it("warns of nothing for a Tool the privacy policy in effect names, nor for one in the EU", async () => {
    expect(await change(stateOf(LUSHA_CHOSEN), stateOf({ ...LUSHA_CHOSEN, LUSHA_API_KEY: "key" }), policyNaming("lusha", "stripe"))).toMatchObject({ ids: [], recorded: [] });
    expect(await change(stateOf(), stateOf({ MISTRAL_API_KEY: "key" }))).toMatchObject({ ids: [], recorded: [] });
    expect(await change(stateOf(), stateOf({ ANTHROPIC_ENDPOINT: "vertex", VERTEX_PROJECT_ID: "jobbbox" }))).toMatchObject({ ids: [], recorded: [] });
  });

  it("warns of nothing for a Tool that was already on, one the change leaves off, or one that receives no personal data", async () => {
    const apolloOn = { CONTACT_ENRICHMENT_PROVIDER: "apollo", CONTACT_ENRICHMENT_DPA_SIGNED: "true", APOLLO_API_KEY: "key" };
    expect(await change(stateOf(apolloOn), stateOf({ ...apolloOn, MAIL_FROM: "Jobbbox <bonjour@jobbbox.ai>" }))).toMatchObject({ ids: [], recorded: [] });
    // Lusha's key saved while Apollo is the provider chosen: Lusha stays off.
    expect(await change(stateOf(apolloOn), stateOf({ ...apolloOn, LUSHA_API_KEY: "key" }))).toMatchObject({ ids: [], recorded: [] });
    expect(await change(stateOf(), stateOf({ FANTASTIC_JOBS_API_KEY: "key" }))).toMatchObject({ ids: [], recorded: [] });
  });

  it("warns of every Tool one change switches on, a Sign-in Provider's among them", async () => {
    const { ids, recorded } = await change(stateOf(), stateOf({ BRAVE_SEARCH_API_KEY: "key" }, ["oidc"]));
    expect(ids).toEqual(["brave", "oidc"]);
    expect(recorded.map((entry) => entry.target)).toEqual(["brave", "oidc"]);
  });

  it("writes nothing when the change fails, its error thrown", async () => {
    const recorded: BackOfficeChange[] = [];
    const failing = switchingOn({ state: async () => stateOf(), policy: () => NO_POLICY, record: async (entries) => void recorded.push(...entries) }, async () => {
      throw new Error("refused");
    });
    await expect(failing).rejects.toThrow("refused");
    expect(recorded).toEqual([]);
  });
});

describe("uncoveredRecipient — the warning a Tool's Outils page keeps while it is on and not covered (#548)", () => {
  const lushaOn = stateOf({ ...LUSHA_CHOSEN, LUSHA_API_KEY: "key" });
  const status = (id: string, state: ToolsState) => toolStatus(tool(id), state).status;

  it("is shown while a recipient outside the EU is on and the privacy policy in effect does not name it", () => {
    expect(uncoveredRecipient(tool("lusha"), status("lusha", lushaOn), NO_POLICY)).toBe(true);
    expect(uncoveredRecipient(tool("greenhouse"), status("greenhouse", lushaOn), NO_POLICY)).toBe(false);
  });

  it("is not shown once the policy names it, while it is off, nor for a Tool in the EU", () => {
    expect(uncoveredRecipient(tool("lusha"), status("lusha", lushaOn), policyNaming("lusha"))).toBe(false);
    expect(uncoveredRecipient(tool("lusha"), status("lusha", stateOf(LUSHA_CHOSEN)), NO_POLICY)).toBe(false);
    expect(uncoveredRecipient(tool("mistral"), status("mistral", stateOf({ MISTRAL_API_KEY: "key" })), NO_POLICY)).toBe(false);
  });
});
