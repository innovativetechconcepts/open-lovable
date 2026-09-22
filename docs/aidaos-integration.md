# aidaOS publishing integration

## Upstream pin

- Repository: `firecrawl/open-lovable`
- Commit: `69bd93bae7a9c97ef989eb70aabe6797fb3dac89`
- Integration branch: `feat/aidaos-artifact-pipeline`
- License: MIT

Every upstream update must be reviewed and the constant in `lib/aidaos/publishing-adapter.ts` changed deliberately. The published bundle records this commit.

## Trust boundary

Open Lovable and all generated source run in an ephemeral sandbox. The adapter creates `.aidaos-build`, copies a canonical source envelope into it, and invokes a fixed Vite build. The sandbox receives no Firebase Admin credential, R2 credential, Cloudflare credential, admission key, or publisher bearer token.

The Next.js server route holds only a narrowly scoped publisher bearer token. It sends the source envelope and bounded static output to the trusted aidaOS publisher. The publisher must independently validate the source, artifact paths, MIME types, byte counts, digests, tenant binding, admission receipt, and preview grant before it stores or serves anything.

The browser trigger is gated by `NEXT_PUBLIC_AIDAOS_PUBLISHING_ENABLED=true`. Keep it false until the publisher endpoint exists and the security review approves the complete request path.

## Pilot limits

- 100 source files, 2 MiB total source
- 200 artifact files, 2 MiB total artifact payload
- Accepted output: one HTML shell and JS, CSS, PNG, JPG, WebP, or WOFF2 assets
- Page metadata and tenant/public identifiers come from server configuration
- The browser supplies only the active sandbox identifier
- The publisher request refuses redirects and requires HTTPS outside localhost

The 2 MiB artifact limit keeps the single pilot request below common serverless request limits after base64 encoding. A production version should use a publisher-created upload session with per-file signed uploads rather than increasing this limit.

## Rollout gates

1. Implement the trusted publisher endpoint in the isolated aidaOS publishing project.
2. Verify exact contract parity with `aida-generated-page-pilot-v1`.
3. Add authentication and tenant authorization to this fork before accepting arbitrary site identifiers.
4. Run an adversarial review covering source imports, build output, redirects, token handling, replay, cross-tenant writes, and preview revocation.
5. Enable the browser trigger only after that review passes.

