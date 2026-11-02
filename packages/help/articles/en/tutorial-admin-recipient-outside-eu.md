---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Switch on a recipient outside the EU
synonyms: [outside the eu, recipient outside the eu, transfer, privacy policy, notice, gdpr, not covered, residency, recipient list, sub-processor, switch on a provider]
---
A tool that receives personal data, or queries drawn from it, outside the EU (or where that is not established) is a recipient outside the EU. Adding one changes the privacy policy substantially: its new version, and its 30-day notice, come before it is switched on in production.

1. In Tools, find the tool: the « Data processed » column says « Outside the EU » or « Not established ».
2. Before switching it on in production, ask the Jobbbox team for a new version of the privacy policy naming it. The product owner has it reviewed, sets its effective date and publishes it: the people concerned are told 30 days ahead.
3. Once that version is in effect, switch the tool on in Settings: enter its key, make it active or enable its source.
4. Check that no « …: recipient outside the EU not covered » warning shows.

Settings never blocks the switch, so that an emergency change stays possible. Switched on without being named by the policy in effect, the tool raises the warning « This recipient is outside the EU and the privacy policy in effect does not cover it. », on Settings and on its page in Tools, with the version of the policy in effect. A « Recipients outside the EU » line is written to Administrator actions. The Beta warns too, to test it; only production counts for the Recipient list.
