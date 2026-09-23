# aidaOS publishing pilot v2

This deployment is a private, single-operator builder. It is not a multi-user tenant editor.
Every API handler authenticates the operator independently of middleware. The server layout also checks authentication. Mutations require the configured Origin, and the Host must match that origin. The legacy E2B creation route is disabled.

## Configuration

Keep both publication flags false until the v2 changes are reviewed and the paired origin is deployed. Required server variables:

- `AIDAOS_OPERATOR_USERNAME`: one ASCII operator name.
- `AIDAOS_OPERATOR_PASSWORD`: independently generated secret, at least 32 characters.
- `AIDAOS_SESSION_SECRET`: separate random signing secret, at least 32 characters.
- `AIDAOS_BUILDER_ORIGIN`: exact HTTPS alias origin, without trailing slash.
- Existing publishing endpoint, server bearer and fixed pilot target variables.
- Vercel Sandbox credentials through deployment OIDC (or the existing explicit token/team/project configuration).

Use the browser's HTTP Basic sign-in challenge. Never place credentials in NEXT_PUBLIC variables, generated source, URLs or the editor sandbox. Rotate the password to revoke operator access; rotate the session key to revoke signed sandbox sessions.

## Ownership and recovery

The Secure, HttpOnly, SameSite=Strict, host-only cookie contains an HMAC-authenticated owner, sandbox ID and 30-minute expiration. It is the durable session capability; the editor has no process-global sandbox registry. Every fresh request verifies the cookie before calling Sandbox.get, and rejects arbitrary sandbox IDs before reaching the SDK. Sandbox TTL is 30 minutes. An expired sandbox requires creating a new editor session, not silently attaching another VM. Conversation caches are request-local, and source files remain in the owned VM.

## Preview and publication

Preview captures normalized source only. It cannot supply a lockfile, compiler, artifact or claimed build provenance. The origin validates source and builds in a fresh private sandbox using its deployed package lock and template. The origin persists the job and admitted release, then issues a 15-minute private preview. No public pointer changes during Preview.

Publish previewed version publishes exactly that admitted release. Later edits require another preview to publish those edits. Each job carries the original site version; a stale draft conflicts. Publication stores its operation result atomically with the site pointer and audit event, so lost responses and old retries cannot republish over a newer release or after unpublish.

Incomplete build jobs are fail-closed: a request with the same ID is rejected until ready. Start a new preview after an interrupted or failed build. No automatic retry updates publication state.

## Verification

- `pnpm test:aidaos`: source capture, JSX normalization/order, route auth/CSRF, signed ownership and process-independent reconnect regression tests.
- `pnpm build`, then `node tests/aidaos-http-smoke.mjs`: real production HTTP denial/authorization checks using synthetic operator credentials.
- Paired origin tests cover trusted compilation, source policy, private previews, atomic idempotency, stale drafts and unpublish retries.

The pilot remains limited to the existing source and artifact policy. General media import, linked real funnels and customer-owned custom domain binding require separate end-to-end work. Do not interpret the pilot fixtures as proof of those flows.
