---
kind: faq
audience: administrator
topic: ia-et-conformite
title: "AI literacy (AI Act, Art. 4): what every Administrator must know"
synonyms: [ai literacy, ai act, article 4, ai training, compliance, ai providers, anthropic, claude, mistral, openai, perplexity, outside the eu, redaction, redacted, eu ai consent, guardrails, what never to do]
---
Article 4 of the AI Act asks Jobbbox to support the AI literacy of everyone who uses or tunes its AI systems on its behalf: you, as soon as you hold a back office role. No level or certificate is required. This article is the basis of that literacy; read it when you are given a role, with the internal « outside Annex III » note, and read it again when it changes.

**What AI does in Jobbbox.** The AI Coach and its Playbook Agents, the documents written (tailored CV, cover letter, Company Dossier, Job Offer summaries), reading CVs and Job Offers, reading offer emails, web search and the Back Office Assistant. The Match Score and the ATS Score rest on rules, not on an AI. AI can be wrong: it helps the Candidate, never decides for them, and never ranks a Candidate for an employer.

**The providers.** Each AI task has its provider and model, set in Paramètres, « AI » tab. Claude (Anthropic) is reached through its direct API, outside the EU. Mistral AI is in the EU. OpenAI, when configured without EU data residency, and Perplexity, for web search, are outside the EU. The back office marks each choice outside the EU « outside EU ». Jobbbox's data stays stored in the EU; what may leave is the text of a call.

**Redaction.** Before a call leaves for a provider, Jobbbox takes out every email address and phone number, and what it knows of the Candidate's identity: full name, last name, address, email, phone. Each becomes a placeholder such as « [NOM] ». The first name stays, and the rest of the CV goes: employers, job titles, dates, schools. That is still personal data, pseudonymised, not anonymous. A name Jobbbox does not know goes through, such as a referee's. Never say « anonymised » or « no data leaves the EU ».

**The Mistral route.** A Candidate may give their EU AI Consent, dated and withdrawable from their account. Their calls carrying their identity then go, unredacted, to Mistral in the EU; without that consent, they go redacted to the task's provider. Reading offer emails always stays in the EU. Paramètres refuses (`data_residency`) to send the identity route or an EU-only task outside the EU.

**Guardrails.** They check the messages and replies of the AI Coach, the Playbook Agents and the assistant, and the emails received, by fixed rules or with an AI. They only block what they detect, and let things through when the AI check is unavailable. In distress, the Candidate receives 3114 and no one is alerted. Only playbooks and messages validated by a person are served in production.

**What you must never do.**
- Paste a Candidate's email, message or CV into the Back Office Assistant, or into an outside AI tool.
- Open a call in Activity › AI calls or a Candidate's Job Search without needing to: each opening is recorded in Administrator actions.
- Validate a version you wrote, or validate on the strength of a score or an AI's opinion alone.
- Switch on a recipient outside the EU, or move a task outside the EU, without the privacy policy version that covers it.
- Write a secret or personal data into a help article, a playbook or a Guardrail message.
- Use Jobbbox's AI to rank, sort or recommend Candidates to a recruiter: that would be a high-risk system (see the « outside Annex III » note).
- Promise guaranteed safety, « EU only » or « anonymised ».

When in doubt, ask a super-admin before acting.
