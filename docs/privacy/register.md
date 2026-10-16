# Privacy register

Jobbbox's record of processing activities (GDPR art. 30). One entry per processing; each names its purpose, legal basis, people and data concerned, who can read it, where it is stored and how long it is kept. Add an entry with the change that starts a new processing.

Controller: Jobbbox. Hosting: the EU, per ADR-0007 and `docs/ops/hosting.md`; no transfer outside the EU.

## Back Office Audit (#203)

| | |
| --- | --- |
| Purpose | Keep a record of every change made in the Back Office (Plan Quotas, Human Coaches, and later Back Office Roles and Provider Secrets): who made it, what it was before and after, when. It lets the Jobbbox team find out who changed a setting, correct mistakes and answer for changes that affect Candidates and Human Coaches. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): accountability and security of Jobbbox's own administration. The record holds no more than the change itself. |
| People concerned | Administrators (Jobbbox team members who made the change). Human Coaches, when the change is about them. |
| Data | The Administrator's Candidate id and the email address they had when making the change; the date and time; the Back Office section, the item changed (a Plan, a Human Coach's email) and the action; the values before and after. For a Human Coach: name, email, Cal.com booking link and bio. Secret values (Provider Secrets) are never recorded, only that they were replaced. |
| Source | Written by the web app, in the same database transaction as the change, from the signed-in Administrator. |
| Who can read it | Administrators, on the Back Office Journal page (`/admin/journal`): those listed in `ADMIN_EMAILS` until Back Office Roles land, then super-admins only. Anyone else gets a 404. |
| Storage | The `back_office_audit` table in the app's Postgres database (EU). |
| Retention | 3 years from the change. The worker's nightly job `back-office-audit.purge` deletes older entries. When an Administrator's account is deleted, their entries stay until then, their Candidate id set to null and the email they had kept, so the record still says who made each change. |
| Rights | Not part of a Candidate's account data export (it is Jobbbox's operations record, see `OPERATIONS_RECORD_TABLES` in `apps/web/src/candidate-data`). An Administrator or Human Coach who asks for access to, or erasure of, what it holds about them is answered by the Jobbbox team directly; a request to erase is weighed against the legitimate interest above (GDPR art. 17(1)(c) and 21) within the 3 years. |
| Security | Back Office pages and writes check the Administrator on every request. Entries cannot be edited from the app; they are only added, read and purged. |
