# The app sends its session only to the web app's host and follows redirects itself

Status: accepted (#756)

The Jobbbox app calls the web app and downloads files (Tailored Documents, the Data export) with the Candidate's session cookie. A system download or `fetch` follows any redirect with that cookie, to another host too.

- **Every call carrying the session goes through `fetchOnWebApp`** (`apps/mobile/src/web-app.ts`), with `redirect: "manual"`: the app follows redirects itself, on the web app's origin only. A 303, or a 301/302 after a write, becomes a GET without its body.
- **It refuses** a redirect to another host, one with no address, more than 5 hops, and a starting address off the web app. Nothing is sent to the other host.
- **Downloads no longer use `File.downloadFileAsync`** for the Tailored Documents: they fetch, then write the file.

Whether `expo/fetch` returns a readable 3xx with its `Location` header in manual mode is not verified on a device; if it does not, even a same-origin redirect fails rather than being followed.

## Considered Options

- **Letting the system follow redirects**: rejected: the cookie would reach any host a redirect names.
- **Dropping the cookie on a cross-host redirect and following on**: rejected: the app has no reason to leave the web app's host; a refusal is simpler to test and to explain.
