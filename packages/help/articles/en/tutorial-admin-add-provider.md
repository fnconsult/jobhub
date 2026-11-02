---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Add a provider and make it active
synonyms: [add a provider, new provider, make active, active provider, change provider, connect a service, api key, web search, perplexity, brave, tavily]
---
A provider is added by entering its key on its sheet, then becomes its tab's active provider. Only super-admins enter a key; « Technique » can make active a provider whose key is already entered.

1. Open Settings, then the provider's tab, for example « Web search ».
2. Click « + Add », choose the « Provider » type, then the provider in the « Provider » list, and click « Open its sheet ». You can also click its name in « Possible providers ».
3. Under « Keys » on its sheet, open « Replace … » for its key, paste it in « New value of … », then click « Test and save … ». The key is tested with the provider, encrypted, and never shown again.
4. Check the message « … replaced: the connection test passed. » and, in « Possible providers », the « Status » « Configured ».
5. In the « Actions » column of its row, click « Make active ». It moves to the « Active provider » card and serves from the next call, without a restart.

A provider made active without its key is accepted, with the warning « No key: calls will fail until it is entered. » For an AI model there is no active provider: choose each task's provider in the « AI » tab. If the provider processes data outside the EU, read « Switch on a recipient outside the EU » first.
