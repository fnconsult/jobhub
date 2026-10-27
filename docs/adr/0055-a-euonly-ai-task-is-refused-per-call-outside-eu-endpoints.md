# An EU-only AI task is refused per call on any endpoint outside the EU

Reading an email of job offers (AI task `offer_email_reading`, #444) carries a third party's words, so it must never leave the EU, even with the Candidate's EU AI Consent (which only covers the Candidate's own identity).

- **The rule is about the endpoint, not the provider.** Claude reached in the EU (Bedrock, Vertex) is allowed; the default route `anthropic` falls back to Mistral when Claude is not reached in the EU.
- **Checked on every call** (`euOnly(task)` in `@jobhub/ai`): the configured route, a Playbook Agent's route and the identity route alike. A route outside the EU fails that call with reason `data_residency`; nothing is sent. The AI layer still starts, so one bad route stops only this task.
- **Playbook Agent**: only EU-resident models are offered and saved for the task's playbook; a served agent outside the EU is dropped with a warning and the configured route is used.
- **Email intake is held back** while no version of its Task Playbook is served (Production serves Human-validated versions only), so it counts as off whatever its switch.

## Considered Options

- **Check once at start-up**: a mistaken route would stop the whole AI layer for every task.
- **Allow non-EU routes with EU AI Consent**: the consent does not cover third parties.
