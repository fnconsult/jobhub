---
kind: faq
audience: administrator
topic: fournisseurs-et-tools
title: Which role changes what in providers and tools?
synonyms: [back office role, role, roles, rights, permissions, super-admin, technique, support, read only, who can, access, change a key]
---
Your back office roles decide what you read and change on Settings and Tools:

- **Super-admin**: changes everything, provider keys included (replacing, clearing, testing them) and the sign-in providers.
- **Technique**: changes every setting of Settings that is not a secret (active provider, an AI task's route, the tools' prices), the sources and the sites; sees the keys by their source and last 4 characters, never replacing one; reads the sign-in providers and Tools.
- **Support**: reads Settings, the sources and the sites, the sign-in providers and Tools, changing nothing; of a key, it only sees whether it is « Set » or « Missing ».
- **Playbook editor**: does not touch the providers, but validates in Playbooks the version that a change of a Playbook Agent's model created as a draft.

The other roles (« Plans manager », « Coach manager », « Help editor ») do not open these pages. A page your roles do not allow you to change shows « Read only: your roles do not allow changes to this section. » Roles are given in Administrators, by a super-admin.
