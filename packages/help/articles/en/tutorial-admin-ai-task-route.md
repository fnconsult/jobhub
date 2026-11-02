---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Change an AI task's provider or model
synonyms: [ai task, route, ai routing, model, provider, mistral, claude, bedrock, change model, refused, route_missing, test_failed, residency, outside the eu]
---
Each AI task has its provider and model, a Platform Setting applied from the next call. Super-admins and « Technique » change it.

1. Open Settings, « AI » tab. The « Tasks » table shows each task with its « Provider · model », its « Source », the « Provider's key » and its « Data ».
2. On the task's row, click « Edit… ». The « AI task » panel opens at the side.
3. Choose the « Provider », then the « Model »: left empty, it is the provider's default model; a model typed in is tested by a call when saved.
4. Click « Save ». The message « Route saved: it applies from the next call, without a restart. » confirms it; a run already started keeps its model.
5. To go back to the environment's value, else the code's default, click « Restore the default ».

The route is checked before it is saved. When refused, it stays as it was, with a message « … was not changed: … » and its « Detail: »:

- « No provider configured for this task » (`route_missing`): this provider does not serve this task, or a setting it needs is missing. Choose another one.
- « Data residency rule » (`data_residency`): the task runs only in the EU and the provider is outside the EU. Choose a provider in the EU.
- « Connection test failed » (`test_failed`): the test call to the model typed in failed. Check the model's name with the provider.

A provider without its key is flagged, never refused: its calls fail until the key is entered. A Playbook Agent's model is changed with « Edit… » under « Playbook Agents »: it creates a draft version to validate in Playbooks.
