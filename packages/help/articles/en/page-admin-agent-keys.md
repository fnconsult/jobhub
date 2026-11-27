---
kind: page
audience: administrator
topic: ia-et-conformite
title: Agent keys (Clés d'agent)
synonyms: [agent keys, agent key, clés d'agent, agent token, feedback triage, triage-beta, triage-prod, ai agent, api, revoke, expiry, call log, fingerprint]
route: /admin/parametres?tab=cles-agent
---
The « Agent keys » tab of Settings, for super-admins only, creates the keys that let an AI agent read the feedback queue to triage it. A key opens no back office page, works for no other part of the API and is never an administrator's session: outside its scope, Jobbbox ignores it and answers as without it, so the public pages and the app's health check answer the agent as usual. It belongs to the environment, not to the person who created it.

« Create a key » asks for a « Name » (lower-case letters, digits and hyphens, for example triage-beta), a « Scope » (only « Feedback » today) and an « Expiry, in days » of 90 days at most. The key's value shows only once, right after it is created: copy it at once. Jobbbox keeps only its fingerprint and can never show it again.

The list shows each key with its scope, creation date, expiry, « Last used » and « State » (active, revoked or expired). « Revoke » cuts the key off at once: revocation and expiry are read again on every call. « Log » shows its latest 50 calls in its scope: the date, the path asked for and the result (accepted, or refused because the key is revoked, expired or over the rate limit), never the content returned. A call outside its scope is not in it and does not count as « Last used ».

With the « Feedback » scope, the agent reads only the feedback sent with the notice « An AI tool may read your message to help us handle it. », anonymised: the Candidate's name, email and phone are replaced with « [NOM] », « [E-MAIL] »…, the page comes without its ids (/candidatures/:id), and never the Candidate's email, name, Plan or id. It can only mark « Seen »: Feedback then shows « seen by triage-beta ».

Each key created or revoked is recorded in Administrator actions by its name, never its value.
