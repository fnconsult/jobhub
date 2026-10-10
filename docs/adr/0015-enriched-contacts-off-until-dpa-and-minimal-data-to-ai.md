# Enriched Contacts stay off until the DPA is signed, and the AI sees only a name and title

Enriched Contacts are personal data about third parties, bought from a licensed provider (Lusha, Kaspr or Apollo; ADR-0001 rules out scraping LinkedIn). The feature is off unless a provider is chosen by configuration, its key is set and `CONTACT_ENRICHMENT_DPA_SIGNED=true`. The flag is a deliberate manual step: the code cannot tell whether the data-processing agreement exists, so a key alone never turns the feature on.

Finding people is free; only a reveal that brings back details counts one against the Plan Quota, and a failed or empty reveal gives the use back. Revealing the same person again is free. We rejected counting searches: Candidates would pay for results with no contact details.

Each row keeps the provider, the provider's id for the person, and when it was found and retrieved, so a GDPR request can be traced to its source. Rows are deleted with their Application. Providers that ask people not to be contacted are respected (Lusha is called with `excludeDnc`).

Only the chosen recipient's name and job title reach the AI when it drafts an Outreach Message, never their emails, phones or provider data. The AI may name that recipient and no one else; the other Tailored Documents name no one.
