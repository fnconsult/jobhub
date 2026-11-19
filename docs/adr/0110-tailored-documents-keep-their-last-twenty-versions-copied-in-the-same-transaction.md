# Tailored Documents keep their last twenty versions, copied in the same transaction

Status: accepted (2026-11-19, #1079). Follows ADR-0109.

Before #1079, a Tailored CV, a Cover Letter or an Outreach Message held only its current text. Drafting again (« Remplacer et rédiger »), applying a Coach proposal (ADR-0109) or the Candidate's own save replaced it, and the earlier text was gone. The Master CV already had a history: each change makes an immutable Master CV Version, and a Restore makes an earlier one current again.

## Decision

- **The document stays where it is; each change copies its new state into a version.** `tailored_document` and `tailored_cv.saved` still hold the current document. Every writer (`draft`, `edit`, `rework`, `unrework`, the Tailored CV `save`, and `restore`) calls `keepVersion` in its own transaction, after the row write, and adds a row to `tailored_document_version` with its number, date, origin (`drafted`, `candidate`, `coach`, `restored`), the version it restored from, its Document Language and the document's content. A save that changes nothing adds no version.
- **Restore never deletes.** Restoring a version adds a new version with that content; the AI Coach proposes one as a card (`propose_document_restore`), applied from the version it saw, or refused as a conflict.
- **Unlike Master CV Versions, the history is capped.** Each document keeps its last 20 versions (`MAX_DOCUMENT_VERSIONS`); past that, the oldest is deleted first, in the same transaction. A Tailored Document is written for one Job Offer and redrafted often, where a Master CV is the long-lived reference.
- **A Cover Letter has no subject** (its body only, #162); an Outreach Message version keeps its subject.
- **What the AI Coach reads.** `read_document_versions` lists versions by number, date, origin, language and current mark only, so the listing stays trusted; one version's text and subject come back as untrusted data (ADR-0077, ADR-0109).

## Considered Options

- **The Master CV Versions model, where the version is the document**: rejected. Every reader of Tailored Documents (export, Coach Access, the AI Coach, the Work Pane) would have to change, and #1075 had just added `tailored_document.origin`.
- **No cap**: rejected. Redrafting is frequent and every version keeps the full text; 20 covers going back several drafts.

## Consequences

- The migration is idempotent: each existing document becomes its version 1, with its origin guessed from `origin` and its timestamps.
- Versions are in the Data export, deleted in cascade with their Application and the account, and shown read-only in Coach Access. The privacy register says so; a « Légal : » issue (#1082) drafts the privacy policy's change.
