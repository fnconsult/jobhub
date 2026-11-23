# Tailored CVs never invent facts

To push a Match Score higher, the AI Coach could add keywords, skills or experience that the Candidate doesn't have. We forbid this. A Tailored CV may only rephrase, reorder, cut and emphasise facts that are in the Master CV. When the Job Offer asks for something missing, the AI Coach asks the Candidate, and adds it only if they confirm it. The Candidate reviews the changes against the Master CV and approves them before the Tailored CV is saved. Senior candidates are tested hard in interviews, and an invented line on a CV costs them more than a lower score. Each change is accepted or rejected individually and the accepted ones are always sent explicitly with the save, never inferred on the server; a change flagged as bringing in Job Offer words is never saved without an explicit accept.

## Amended by ADR-0113 (2026-11-23)

A fact the Candidate states in the Coach Conversation (a Declared Fact) counts as a confirmed requirement: the AI Coach may propose it in the Tailored CV or the Master CV, marked « Fait déclaré par vous », once the server has found it in one of the Candidate's own messages. A change that brings in Job Offer words is marked the same way in the Master CV's review. Every change is still accepted or rejected on its own.
