---
kind: page
audience: administrator
topic: plateforme
title: Administrator actions (the journal)
synonyms: [journal, audit, administrator actions, change history, who changed, before after, refused attempt, back office audit, tools filter, linked mailboxes, traceability]
route: /admin/activite/actions
---
Activity's « Administrator actions » tab is the back office's journal, formerly « Journal ». It records every change made in the back office: who, when, the section, the item, the action, and the values before and after. It also records every attempt refused or failed, with its reason but without the values entered, and every AI call or Candidate's Job Search a super-admin opened.

Secret values are never recorded: a key shows « Value replaced (never recorded) » or « Value cleared: the environment variable is used again ». An unanswered question or a piece of feedback is named by its identifier, never by its words. Each entry is kept 3 years.

« Show » filters by section: « All », « Roles », « Plans », « Coupons », « Human Coaches », « Coaching Playbooks », « Guardrails », « Feedback »… The « Tools » filter adds every call to an external tool (Stripe, Brevo, sign-in, connection tests, pages read), with its tool, operation, outcome and duration: no content, no Candidate, no secret. The « Linked mailboxes » filter adds the Linked mailboxes switched on, replaced, switched off or at their daily cap, with no Candidate or address. The most recent changes come first.

Super-admins and Technique read this journal. No one changes it or erases a line.
