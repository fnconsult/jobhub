# The request Surface is read from Next's per-request context, not set with `enterWith`

Status: accepted (#919)

Each AI call keeps its Surface (`web`, `extension`, `app`, `worker`) on AI Usage and the AI Message Log. The AI layer has no request in hand when it records a call, so the Surface has to reach it from the route that received the request.

- **Decided: the Surface is worked out where the call is recorded, from the headers of the request being handled**, read with `headers()` from `next/headers`, inside the per-request context Next already opens (itself an AsyncLocalStorage, `run()` once per request). `requestSurface(headers, webOrigin)` reuses the origin check's reading of those headers; `currentRequestSurface()` never throws and returns null outside a request. No route changed.
- **Rejected: our own AsyncLocalStorage set from `isFromTrustedOrigin` with `enterWith`.** On Node 22, the production image, `enterWith` called inside a promise reaction leaks the store into the caller's context, so a Surface could carry over to other work. Confirmed in a scratch script. `run()` would need every route wrapped.
- **The worker passes `worker` explicitly** to `createPostgresUsageLog` (`surface` option).
- **A Surface that cannot be read is null**, and the call is still recorded. Null shows as « Inconnue ».
- **Limits**: a request that sends no Origin (Back Office server actions, page renders) records none, and nothing separates surfaces for clients outside a browser, which can forge the headers. The Surface is for reporting, never for access or behaviour.
