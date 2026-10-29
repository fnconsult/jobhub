# An EU-only AI task is refused per call on any endpoint outside the EU

Reading an email of job offers (AI task `offer_email_reading`, #444) carries a third party's words, so it must never leave the EU, even with the Candidate's EU AI Consent (which only covers the Candidate's own identity).

- **The rule is about the endpoint, not the provider.** Claude reached in the EU (Bedrock, Vertex) is allowed; the default route `anthropic` falls back to Mistral when Claude is not reached in the EU.
- **Checked on every call** (`euOnly(task)` in `@jobhub/ai`): the configured route, a Playbook Agent's route and the identity route alike. A route outside the EU fails that call with reason `data_residency`; nothing is sent. The AI layer still starts, so one bad route stops only this task.
- **Playbook Agent**: only EU-resident models are offered and saved for the task's playbook; a served agent outside the EU is dropped with a warning and the configured route is used.
- **Email intake is held back** while no version of its Task Playbook is served (Production serves Human-validated versions only), so it counts as off whatever its switch.

## Amendment (2026-10-30): Mistral's EU host

Mistral is only EU on its regional host `api.eu.mistral.ai` (inference in EU and EFTA data centres, 1.1× list price). Of its global host `api.mistral.ai` Mistral says it does not commit to an inference location (https://docs.mistral.ai/inference/regional-inference, research `docs/research/issue-522.md`). So the Mistral provider calls `api.eu.mistral.ai`, and the endpoint catalogue (`@jobhub/shared`) counts `api.mistral.ai` as outside the EU. The regional host has no Agents, Batch or Files API; Jobbbox uses only chat completions and the model list there.

## Considered Options

- **Check once at start-up**: a mistaken route would stop the whole AI layer for every task.
- **Allow non-EU routes with EU AI Consent**: the consent does not cover third parties.
