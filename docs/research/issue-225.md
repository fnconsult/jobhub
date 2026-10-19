# Issue #225 research: provider facts for Playbook Agents

Scope: only the outside facts #225 needs, namely per-provider effort translation (low/medium/high), "EU-resident model" per provider, and what a Back Office warning "model ignores effort" can rely on. Checked 2026-10-19 against first-party docs. Code decisions are left to the implementer.

## 1. Effort translation per provider

### Anthropic (Messages API)
- Parameter: `output_config.effort`, values `low`, `medium`, `high`, `xhigh`, `max`. No beta header. Source: https://platform.claude.com/docs/en/build-with-claude/effort
- Supported models (list on that page): Fable 5/5.1, Mythos 5/5.1, Opus 4.5 to 5.5, Sonnet 4.6, 5, 5.5, Haiku 5.5. Not listed (so effort is not documented as supported): Sonnet 4.5, Haiku 4.5 and earlier. For those the Back Office should say effort is ignored.
- `low`, `medium` and `high` exist on every supported model, so the three Playbook levels map 1:1 (`xhigh` and `max` are not needed).
- Defaults: `medium` on Opus 5.5 and Haiku 5.5, `high` elsewhere. Passing the default equals omitting it. Same page.
- Effort affects all output tokens (text, tool calls, thinking). It is "a behavioral signal, not a strict token budget".
- Thinking is a separate control. Adaptive thinking (`thinking: {type: "adaptive"}`) is the mode on 4.6+; `thinking.type: "enabled"` with `budget_tokens` is deprecated on 4.6 and returns 400 on 4.7 and later. Opus 4.5 and older use `budget_tokens` (min 1,024, less than `max_tokens`) and can take effort too. Source: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- Opus 5.5: adaptive thinking cannot be disabled (`thinking: {type: "disabled"}` returns 400). Sonnet 5.5 and Haiku 5.5 reject some thinking settings at `xhigh`/`max` only. Irrelevant at low/medium/high except that a Playbook Agent should not send `thinking: disabled` to Opus 5.5.
- Changing top-level effort between requests invalidates the prompt cache, so effort is a per-agent constant (matches the issue: effort lives on the Playbook Version).
- Via Bedrock and Google Cloud the effort parameter is listed as GA too (same page, `supportedPlatforms`).

### OpenAI
- Responses API: `reasoning.effort`; Chat Completions: `reasoning_effort`. Values `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; the supported subset depends on the model. Source: https://developers.openai.com/api/docs/guides/reasoning
- `low`, `medium`, `high` map 1:1 where the model is a reasoning model. Some models reject `none` (HTTP 400); GPT-6 Astra and GPT-6.1 Sol do not take `none`, GPT-6.1 Sol not `minimal` either. Not a problem for low/medium/high.
- The page has no per-model table. Which models accept the parameter must be checked per model page; non-reasoning models should be flagged "ignores effort" in the Back Office.
- Chat Completions does not support function calling with GPT-6 Astra or GPT-6.1 Sol (use Responses). Only matters if Playbook Agents use tools; the issue does not.

### Mistral
- Parameter: `reasoning_effort` on chat completions (also `completion_args` on Agents/Conversations). Documented values are only `"none"` and `"high"` for Mistral models (high adds a thinking chunk before the answer). `zai-glm-5-3` (third-party, hosted by Mistral) accepts `low`, `high`, `max` and not `none`. Source: https://docs.mistral.ai/capabilities/reasoning/
- Adjustable on `mistral-small-latest` and `mistral-large-4-0`; `mistral-medium-3-5` is adjustable (docs recommend `high` for agentic/code).
- So there is no native `low`/`medium` for Mistral models. Suggested translation (implementer's choice, to be confirmed): `low` to `none`, `medium` and `high` to `high`; the Back Office should show that medium equals high for Mistral. For other Mistral models (e.g. Ministral, Large 3) the docs do not list effort, so treat as ignored.
- Because the default Playbook Agent effort is `medium` and identity-bearing calls go to Mistral (see memory/ADR), this quirk matters for the import defaults.

## 2. "EU-resident model" per provider

- **Mistral:** "By default, your data is hosted in the European Union"; US only if the US API endpoint is used explicitly. Some features may send data outside the EU (destinations listed in the Trust Center subprocessors tab); enterprise orgs can disable those. Source: https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-and-are-you-gdpr-compliant . The models overview page (https://docs.mistral.ai/getting-started/models/models_overview/) says nothing about residency. Residency is therefore per endpoint/account, not per model. Third-party models hosted by Mistral (GLM) are not covered by that statement; not verified, treat as not allowed until checked.
- **Anthropic:** residency depends on the route, not the model. Direct API is not treated as EU in this repo (`anthropicInEu` in `packages/ai/src/env.ts`). Bedrock geographic cross-region inference profiles keep processing inside the geography (EU profile stays in the EU), global profiles do not. Source: https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html . The Back Office allow-list must therefore be (provider, route, model), and a Bedrock model must use an EU-geography profile, not a global one. The repo default region is eu-west-3 (Paris), single-region, which also satisfies this. Not re-verified here: which Claude models are available in the EU profiles (check the Bedrock supported models page when seeding the allow-list).
- **OpenAI:** EU data residency exists (EEA and Switzerland) via an EU-region project with `eu.api.openai.com`, or per request with that base URL. It requires eligibility (ZDR, Modified Abuse Monitoring or similar) and approval. Regional processing is supported for chat completions and responses. Listed EU models include GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna (GPT-6 Astra lacks fast mode in EU; it is not listed for EU processing in the summary, so check). Caveats: chat completions cannot set `store=true` outside the US; residency excludes account/billing/usage system data and data sent to third-party MCP servers; models released after 2026-03-05 carry a 10 percent uplift (matters for cost display). Source: https://developers.openai.com/api/docs/guides/your-data . The repo already has `OPENAI_DATA_RESIDENCY` (eu|us, default eu).
- Implication for the Back Office list: an allowed model is one reachable only through a route configured as EU. Do not hard-code model names from this note; they churn. Derive the allow-list from the configured provider route plus a maintained per-provider model list.

## 3. EU AI Consent and identity
- Nothing external to check: it is a product rule (CONTEXT.md, ADR-0019/0021, memory "identity-bearing prompts use Mistral under EU AI consent"). Residency above is the only outside fact.

## Open items for the implementer
1. Confirm the exact translation for Mistral effort (low to none; medium and high to high) with the owner, and show it in the Back Office.
2. Decide how "model ignores effort" is known: keep a small table in code, keyed by provider and model, from the lists above (Anthropic list from the effort page; OpenAI per model page; Mistral only the models named above).
3. Verify EU availability of the chosen Claude models on Bedrock EU profiles and of the OpenAI models for EU regional processing before seeding defaults.
4. Not covered: pricing per model (needed for the median cost per Playbook Agent). Cost is computed from usage already recorded by the AI layer, so no new external fact is needed.
