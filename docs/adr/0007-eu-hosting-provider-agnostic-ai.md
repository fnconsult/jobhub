# EU hosting and swappable AI providers

CVs are sensitive personal data, and B2B outplacement buyers (ADR-0004) will check where data is stored. All data is stored in the EU. AI calls go through one provider-agnostic layer with four adapters: Anthropic (Claude, the default), Mistral, OpenAI and Perplexity.

The rule for personal data (CVs, Profiles, Applications, Tailored Documents):
- It is sent only to EU-resident endpoints: Claude through an EU region (AWS Bedrock eu-west-3 or Vertex AI EU), Mistral, or OpenAI with EU data residency.
- Perplexity is used only for web search (ADR-0002) and receives only search queries built from Search Criteria, never CV content or names.
