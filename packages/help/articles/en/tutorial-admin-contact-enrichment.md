---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Switch on contact enrichment and its DPA
synonyms: [contact enrichment, enriched contacts, dpa, processing agreement, lusha, kaspr, apollo, sub-processor, phone, mark the dpa signed]
---
Enriched contacts stay off until the DPA (the data processing agreement) with their provider is marked signed, whatever the provider and its key. The code cannot check the DPA: marking it signed is a deliberate step, confirmed and recorded in Activity.

1. Have the DPA signed with the chosen provider, outside Jobbbox. Lusha and Apollo process data outside the EU, Kaspr where that is not established: read « Switch on a recipient outside the EU » first.
2. Open Settings, « Contact enrichment » tab.
3. A super-admin opens the provider's sheet and enters its key, as in « Add a provider and make it active ».
4. In « Possible providers », click « Make active » on the provider's row. The « Enriched Contacts provider » takes its value.
5. In the « Active provider » card, on the « Data processing agreement (DPA) signed » row, choose true in « New value of CONTACT_ENRICHMENT_DPA_SIGNED » and click « Save ».
6. Asked « Mark the DPA signed? », click « Yes, the DPA is signed » if it is true, else « Cancel ».

Enriched contacts then turn on. To stop them, set the same setting back to false, or click « Restore ».
