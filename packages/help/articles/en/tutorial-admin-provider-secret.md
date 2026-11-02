---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Replace or clear a provider key
synonyms: [provider secret, key, api key, replace a key, clear a key, rotation, renew, secret, test a key, connection test, environment, fallback]
---
A provider key (Provider Secret) entered in the back office is encrypted and replaces the environment's within a minute, without a redeployment. Only super-admins replace, clear or test it; « Technique » sees only its source and last 4 characters.

1. Open Settings, the provider's tab, then its sheet by clicking its name in « Possible providers ».
2. Under « Keys », find the key: its source (« Back office », « Environment (fallback) », « Missing » or « Unreadable: the environment stands in ») and its ending.
3. To replace it, open « Replace … », paste the new value in « New value of … » and click « Test and save … ».
4. If the provider refuses the key, nothing is saved: check it. To save it anyway, for example during a provider outage, tick « Save even if the connection test fails »; that choice is recorded in Activity.
5. To go back to the environment's value, click « Clear … (back to the environment) ». With no value in the environment, the key becomes « Missing » and the features depending on it stop.
6. « Test … » runs the connection test of the key in use again, without changing anything.

Never paste a key anywhere but this field: not in the assistant, not in a report. The log only records the replacement, never the value.
