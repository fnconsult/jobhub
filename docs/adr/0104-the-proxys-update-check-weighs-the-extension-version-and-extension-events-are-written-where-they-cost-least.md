# The update check weighs the Extension Version, and Extension Events are written where they cost least

Status: accepted (#924)

Extension Events (`apps/web/src/extension-events`) record what the extension did and what failed. Three choices shaped them.

- **Decided: the proxy's update check reads the Extension Version beside the API Version.** The extension sends `Jobbbox-Extension-Version` on every call. The API Version's guard answers 426 (« Mettez à jour l'extension ») for an API Version no longer served, and now also for an Extension Version below `MINIMUM_EXTENSION_VERSION` (`packages/shared/src/api-version.ts`). The minimum is 0.2.0, so nothing is refused yet; a missing header is not refused. Raising the API Version for a bug in one extension release would force every Candidate to update.
- **Decided: Capture, Profile and Application write their row in the action's own transaction; Match Score and CV draft write it after they succeed, outside any transaction.** The first three save something, so the row and the work stand or fall together (Capture now opens a transaction when called from the extension). The last two save nothing, so a transaction would hold a connection for a row; a lost row there is acceptable, a failed action is not. An Application already saved writes no second row.
- **Decided: the reporting limit (30 per 10 minutes) counts a Candidate by id and a Guest by IP address, in the server's memory only.** The address is never written or stored with the event, which keeps a Guest's Extension Events tied to no identifier. The count restarts with the process and is per instance; the limit guards against a loop, not against an attacker.
- **Rejected: a table of counters or Redis for the limit**, which would keep the address somewhere durable.
- **Limits**: the headers can be forged by a client outside a browser. Extension Events are for reporting, never for access.
