# EU hosting and swappable AI providers

CVs are sensitive personal data, and B2B outplacement buyers (ADR-0004) will check where data is stored. All data is stored in the EU. AI calls go through one provider-agnostic layer with four adapters: Anthropic (Claude, the default), Mistral, OpenAI and Perplexity.

The rule for personal data (CVs, Profiles, Applications, Tailored Documents):
- It is sent only to EU-resident endpoints: Claude through an EU region (AWS Bedrock eu-west-3 or Vertex AI EU), Mistral, or OpenAI with EU data residency.
- Perplexity is used only for web search (ADR-0002) and receives only search queries built from Search Criteria or from an employer's name, never CV content or a person's name.

## Amendment: employer names in web search (issue #17)

A Company Dossier for an employer that is not in the French company register (a foreign company, mostly) can only come from the web, so the web search also receives a query built from the employer's name (`buildCompanyQuery`). An employer's name is about a company, not the Candidate: it is public, it comes from the public Job Offer or from the Candidate naming the hiring company, and it carries no CV content. Sending it outside the EU does not move personal data there.

What keeps this from carrying a person's name:
- The query is built from the employer's name alone, cleaned like Search Criteria (no email or phone).
- A name the register lists as a sole trader (a private person), or a SIREN it does not list as a company, is never sent: the Candidate is asked to name the hiring company instead.
- What comes back is filtered before it is stored: only short facts of the expected shape are kept (no street address, nothing naming a person), and only web pages as sources, never a person's profile.
