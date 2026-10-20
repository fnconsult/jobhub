# Issue #233 research: data residency facts for the Tools registry

Scope: #233 is mostly internal (a `TOOLS` constant, a page, a guard test). The one outside fact it needs is each tool's **data residency (EU / outside the EU)** for ADR-0007. Checked 2026-10-20 against first-party pages. Code decisions are left to the implementer. Anything not verified is marked as such; do not present it as fact in the Back Office.

## Rule to follow from the repo (not outside fact)
ADR-0007 (amendment "pluggable web search providers", #110) already classifies Perplexity, Brave, Tavily and Linkup as **outside the EU** ("their data hosting was not established"), because they only receive search queries. Reuse that: `residency: "outside-eu"` for all four, no new claim needed.

## Verified
- **Mistral**: "By default, your data is hosted in the European Union." Using the US endpoint hosts it in the United States, and data "can be temporarily transferred outside of the European Union" depending on the feature. So: EU by default (api.mistral.ai), with a caveat for some features. Source: https://help.mistral.ai/en/articles/347629-where-can-i-find-mistral-ai-s-data-processing-agreement
- **OpenAI**: EU data residency exists (Europe, EEA + Switzerland; `eu.api.openai.com` prefix; regional storage and processing). It is not self-serve: needs sales approval, a Modified Retention amendment, and an EU-region project; +10% price uplift on eligible models released on/after 2026-03-05; `store=true` not allowed on chat completions in non-US regions. So the default global endpoint is **outside the EU**; EU only when the project/prefix is configured. Source: https://developers.openai.com/api/docs/guides/your-data
- **Stripe**: no EU-only residency statement found. Stripe's privacy centre says data may be transferred to jurisdictions of the enabled payment methods; for users outside the Americas the controller is Stripe Technology Company Limited (Ireland); Stripe is certified under the EU-US Data Privacy Framework; its card vault runs on AWS. So treat as **outside the EU** (global processing, DPF transfer basis). Sources: https://stripe.com/privacy-center/legal and https://docs.stripe.com/security

## Already settled in the repo (no outside check needed)
- **Anthropic**: Bedrock eu-west-3 / Vertex EU = EU; direct API = outside the EU (ADR-0007 amendment "redaction replaces EU-only routing"). Effort/EU notes also in `docs/research/issue-225.md`.
- **recherche-entreprises.api.gouv.fr**, **France Travail**, **APEC**: French public services or French operators; no personal data is sent (Search Criteria or an employer name). Mark EU as an assumption, not a verified residency statement.

## Not verified (fetch failed or no first-party statement reached)
- **Brevo** (API and SMTP): privacy page returned only a title, help page 403. Brevo is a French company and markets EU hosting, but this was not confirmed from a first-party page here. Mark `eu` as unverified.
- **Perplexity** FAQ/privacy URLs returned 404. Covered by the ADR rule above.
- **Lusha, Kaspr, Apollo, Greenhouse, Lever, Ashby, Google/Apple/Microsoft sign-in, generic OIDC**: not checked. Suggested defaults: Kaspr (French company) EU unverified; Lusha, Apollo, Greenhouse, Lever, Ashby, Google, Apple, Microsoft outside the EU or unknown; OIDC depends on the configured issuer (residency "varies").

## Recommendation for the data model
Make residency a three-value field, `eu | outside-eu | unknown`, rather than a boolean, so unverified vendors are not asserted as EU. Add a `residencyNote` (e.g. Mistral: EU by default; OpenAI: EU only with a configured EU project). This matches the acceptance criteria without overclaiming.
