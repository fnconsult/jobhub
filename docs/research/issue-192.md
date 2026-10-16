# Research for issue #192: Better Auth roles and permissions for Back Office access

Map: #191. Question: what Better Auth (the version we pin) offers for role-based access (admin plugin, access-control plugin, custom roles and permissions, how roles are stored and checked on the server), and whether it works with our passwordless setup (ADR-0011) without migrating `candidate` data.

Version: `better-auth` `^1.7.7` in `apps/web/package.json`, resolved to **1.7.7** in `package-lock.json`. All claims below come from the installed 1.7.7 package source (`apps/web/node_modules/better-auth/dist/...`, read 2026-10-16), not from docs. Paths below are relative to `better-auth/dist/`.

## Where we are today

- `apps/web/src/admin/access.ts`: `administratorsFromEnv` says a person is an Administrator when `emailVerified` is true and their email is in `ADMIN_EMAILS`. No role is stored anywhere.
- `apps/web/src/auth/index.ts`: Better Auth with `user.modelName: "candidate"`, one additional field (`interfaceLanguage`), and only the `magicLink` plugin plus optional Google. No password sign-in.
- ADR-0014 rejected "a role column or Better Auth's admin plugin for now" and said to revisit later. ADR-0011 commits that adding plugins never migrates Candidate data; `organisation-ready.test.ts` checks this for the organisation plugin with `getMigrations(..., { throwOnUnsafe: false })`.

## Findings

### 1. Access-control plugin (`better-auth/plugins/access`)

- It is pure code with no tables and no endpoints. `createAccessControl(statements)` declares resources and their actions. `ac.newRole({ resource: [actions] })` returns a role with `authorize(request, connector)`. Source: `plugins/access/access.mjs`.
- `authorize` checks every requested resource by default (`AND`), with `OR` as an option. A resource the role does not list is refused. A request with an empty action list is refused. Source: same file.
- So roles and permissions are **TypeScript constants**, fixed at deploy time. Nothing here reads roles from the database.

### 2. Admin plugin (`better-auth/plugins/admin`)

**Storage** (`plugins/admin/schema.mjs`):
- On the user model, which for us is `candidate`, it adds `role` (string), `banned` (boolean, default `false`), `banReason` (string) and `banExpires` (date). All are `required: false` and `input: false`.
- On `session` it adds `impersonatedBy` (string, `required: false`).
- One user can hold several roles. They are stored as one comma-separated string: `parseRoles` joins an array with `,` (`plugins/admin/routes.mjs`), and `hasPermission` splits on `,` (`plugins/admin/has-permission.mjs`).
- A `user.create.before` database hook sets `role` to `defaultRole` (default `"user"`) on new users (`plugins/admin/admin.mjs`). Existing rows keep `NULL`, and `hasPermission` treats `NULL` as `defaultRole`.

**Roles** (`plugins/admin/access/statement.mjs`, `types.d.mts`):
- The built-in statements are `user: [create, list, set-role, ban, impersonate, impersonate-admins, delete, set-password, set-email, get, update]` and `session: [list, revoke, delete]`.
- The built-in roles are `admin` (every action except `impersonate-admins`) and `user` (no actions).
- Custom roles come from the `ac` and `roles` options, built with the access-control plugin. You can add your own resources, such as `plan`, `providerSecret`, `ssoProvider` or `quota`, next to the built-in ones.
- `adminRoles` (default `["admin"]`) must name roles that exist in `roles`, or `admin()` throws at startup.
- `adminUserIds: string[]` grants **every permission** to the listed user IDs, whatever their role (`has-permission.mjs`: the first check returns `true`). The list holds user IDs, not emails.

**How the server checks a role** (`has-permission.mjs`, `routes.mjs`):
- `hasPermission({ userId, role, options, permissions })` returns `true` for an `adminUserIds` match. Otherwise it returns `true` when any one of the user's roles authorizes the request.
- Every admin endpoint uses `adminMiddleware`, which only requires a fresh session from `getAuthoritativeSessionFromCtx`. Each endpoint then calls `hasPermission` with its own required permission, for example `{ user: ["set-role"] }`.
- `auth.api.userHasPermission({ body: { permissions } , headers })` (POST `/admin/has-permission`) is the server-side check for our own resources. It uses the session user's role, or a `userId`/`role` given in the body when there is no session.
- The client has `authClient.admin.checkRolePermission({ role, permissions })`. It is a synchronous, local check for showing or hiding UI, not for security (`plugins/admin/client.mjs`).
- The session's `user.role` is returned by `getSession`, so a route handler can also call `ac`/`roles[role].authorize(...)` directly.

**Endpoints it exposes under `/api/auth/admin/*`** (`admin.mjs`): `set-role`, `get-user`, `create-user`, `update-user`, `list-users`, `list-user-sessions`, `ban-user`, `unban-user`, `impersonate-user`, `stop-impersonating`, `revoke-user-session(s)`, `remove-user`, `set-user-password`, `has-permission`.

**Limits found in the source:**
- **Roles are static.** `set-role`, `create-user` and `update-user` refuse a role that is not a key of `opts.roles` (`YOU_ARE_NOT_ALLOWED_TO_SET_NON_EXISTENT_VALUE`, `routes.mjs`). An Administrator can **assign** a role to a person in the UI. They **cannot create a new role or change a role's permissions** in the UI. That needs a code change and a deployment.
- **Nothing stops a privilege escalation.** Any role with `user: ["set-role"]` can give any defined role to anyone, including itself. There is no "only assign roles at or below your own" rule. If we need one, our own wrapper has to add it.
- **No audit trail.** The endpoints update the row and return. No history of who changed which role is kept, so the "Back Office audit trail" item in #191 stays our own work. Our own code would have to call the endpoints from a seam that logs.
- **Everything is user-scoped.** The plugin covers the whole app. It does not separate Candidates from Jobbbox team members. A team member is a `candidate` row whose `role` is not `user`.
- **Some endpoints do not fit us.** `set-user-password` is pointless without password sign-in. `create-user` and `impersonate-user` exist for any role that holds those permissions. Custom roles that leave out these actions get FORBIDDEN, but the routes stay mounted. Not granting the actions is the control. The core `disabledPaths` option also works in 1.7.7: the HTTP handler returns 404 for any listed path, such as `/admin/set-user-password` (`api/index.mjs` line ~166). This covers HTTP only; server-side `auth.api.*` calls are not affected.
- Bans are enforced in a `session.create.before` hook. A banned user cannot start a new session, and the ban lifts itself after `banExpires`. Existing sessions are only revoked when `ban-user` is called through the plugin.

### 3. Dynamic roles stored in the database exist only for Organisations

- The organisation plugin's `dynamicAccessControl: { enabled: true }` adds an `organizationRole` table (`organizationId` required, references `organization`; `role`; `permission`). It also adds `crud-access-control` routes to create and edit roles at runtime. Source: `plugins/organization/organization.mjs` lines ~665-702, `types.d.mts` line 66.
- These roles belong to **one Organisation** and are checked against `member.role`. They do not apply to `user.role`. Using them for Back Office roles would mean a fake "Jobbbox" Organisation with team members as Members. That clashes with #191's "out of scope: Organisation roles" and with ADR-0004's meaning of Organisation.

### 4. Works with the passwordless setup; no Candidate data is migrated

- The admin plugin depends on no sign-in method. It works with magic link and Google because it only reads `session.user`.
- `user.modelName: "candidate"` applies to the plugin's fields. The plugin's `schema.user` is merged into the user model, so the new columns land on `candidate`.
- Migration behaviour (`db/get-migration.mjs`): adding a column with `required: false` produces a nullable `ALTER TABLE ... ADD COLUMN` (line ~616, `notNull()` only when `required !== false`). `banned` gets `DEFAULT false` (static default, line ~620). An "unsafe change" is reported only for a **required** column with no default on a populated table (line ~600), which none of the admin fields are.
- Expected plan: no new tables. Added columns `candidate.role`, `candidate.banned`, `candidate.banReason`, `candidate.banExpires` and `session.impersonatedBy`. No `unsafeChanges`.
- This changes the existing `candidate` table. It does not migrate data: no backfill, no type change, no rename.
- One difference from ADR-0011's organisation test: that test asserts `toBeAdded` does **not** contain `candidate`. An admin-plugin equivalent would assert that the only additions are those nullable columns.
- Not run against Postgres here. The worktree has no `node_modules`. A one-off test copying `organisation-ready.test.ts` with `admin()` would confirm it.

## Options for the Back Office roles decision (inputs for #193)

| Option | Roles defined | Assignment in UI | Schema change | Notes |
|---|---|---|---|---|
| A. Admin plugin + custom `ac`/`roles` | In code (e.g. `superAdmin`, `billingAdmin`, `supportAdmin`) with our own resources | Yes, via `setRole` or our own wrapper | Nullable columns on `candidate` and `session` | Least code. Role set is fixed per deploy. No audit trail and no protection against escalation built in. Some endpoints stay mounted but are not granted |
| B. Access-control plugin only, our own `administrator_role` table | Permissions in code (`createAccessControl`). Assignment in our table | Yes, our own Back Office form | New table that references `candidate`, no change to `candidate` | Same additive shape as ADR-0011/0014 tables. Audit trail and escalation rules live in our module. No unused `/admin/*` routes |
| C. Fully custom roles in our DB (roles and permissions editable in UI) | DB rows, mapped onto `ac` statements at request time | Yes, including creating roles | New tables | Better Auth 1.7.7 has no user-level dynamic roles. Org dynamic AC (§3) is the only built-in runtime role editor and is org-scoped |
| D. Org plugin + dynamic AC with a "Jobbbox" Organisation | DB (`organizationRole`) | Yes | `organization`, `member`, `invitation`, `organizationRole`; nullable column on `session` | Reuses ADR-0004 machinery for a different meaning. #191 marks Organisation roles out of scope |

In every option the bootstrap super-admin can stay in env (#191 standing choice). That means keeping `ADMIN_EMAILS` (email-based, our code), or using `adminUserIds` (ID-based, admin plugin only), which grants every admin-plugin permission. Our own resource checks would have to read the same list.

## Not verified

- No Postgres migration was run with `admin()` enabled. The migration plan above is read from `get-migration.mjs` and `admin/schema.mjs`.
- Whether the session cookie cache would delay role changes. Our config does not turn on `session.cookieCache`. With it on, `user.role` could be stale for the cache lifetime.
- Better Auth's published docs pages were not compared against the source. Where they disagree, the source above wins for 1.7.7.
