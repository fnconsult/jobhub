---
kind: glossary
audience: administrator
topic: equipe
title: Back office roles
synonyms: [roles, role, back office role, rights, permissions, access, super-admin, plans manager, coach manager, support, playbook editor, help editor, technique, grant a role, revoke a role, read only]
---
A back office role says what an Administrator may see and change. Your roles show on the Dashboard. They are fixed in code; only super-admins grant and revoke them, in Administrators (Team menu), to someone who already has a Jobbbox account.

- **Super-admin**: the whole back office, including Administrators, provider keys, Guardrails, Activity › AI calls and Administrator actions.
- **Plans manager**: Plans, their quotas and coupons.
- **Coach manager**: Human Coaches; reads the AI Coach cost.
- **Playbook editor**: writes, evaluates, validates and archives the Coaching Playbooks, the Core Digest and the Sources list.
- **Help editor**: reads the unanswered questions and marks them « Article written » or dismisses them; reads the questions among the feedback, without the Candidate's email or Plan.
- **Technique**: sets the non-secret settings, the search sources and sites and the prices of tools. Sees keys by their source and last 4 characters, without changing them. Reads the Dashboard, AI consumption, Tools, Activity › Searches, Received emails and Administrator actions.
- **Support**: handles feedback and withdrawals; reads everything else without changing anything, except provider secrets, AI calls and Administrator actions.

A section none of your roles reads is not in the menu. A section you read but cannot change shows read-only. A revoked role stops giving access from the next page. There is always at least one super-admin, and a permanent super-admin (ADMIN_EMAILS) cannot be revoked from the back office.
