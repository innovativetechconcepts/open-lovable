# aidaOS publishing integration

## Upstream pin

- Repository: `firecrawl/open-lovable`
- Commit: `69bd93bae7a9c97ef989eb70aabe6797fb3dac89`
- Integration branch: `feat/aidaos-artifact-pipeline`
- License: MIT

Every upstream update must be reviewed and the constant in `lib/aidaos/publishing-adapter.ts` changed deliberately. The published bundle records this commit.

## Trust boundary

Open Lovable and generated source run in an ephemeral sandbox. The adapter reads a bounded source envelope, optional local media, and up to 20 named page routes. The sandbox receives no Firebase Admin credential, R2 credential, Cloudflare credential, admission key, or publisher bearer token. The trusted publisher validates the envelope and compiles it in its separate fixed build sandbox.

The Next.js server route holds a separate bearer token for each fixed target. It sends only the source envelope to the trusted aidaOS publisher. The publisher independently validates source, artifact paths, MIME types, byte counts, digests, tenant binding, immutable admission receipt, and publication version before it stores or serves anything. It accepts only the reviewed upstream commit and the server-configured target selected by that token.

The general pilot browser trigger is gated by `NEXT_PUBLIC_AIDAOS_PUBLISHING_ENABLED=true`, and its server route requires `AIDAOS_PUBLISHING_ENABLED=true`. The dedicated Elite Assist preview also requires `NEXT_PUBLIC_AIDAOS_ELITE_ASSIST_PREVIEW_ENABLED=true` in the browser and `AIDAOS_ELITE_ASSIST_PREVIEW_ENABLED=true` on the server. Both publisher and builder must keep `AIDAOS_ELITE_ASSIST_PUBLICATION_ENABLED=false` until the review copy and checkout behavior are approved. The browser publish button also stays hidden unless `NEXT_PUBLIC_AIDAOS_ELITE_ASSIST_PUBLICATION_ENABLED=true`.

## Pilot limits

- 100 source files, 2 MiB total source
- 20 named pages and 1.5 MiB total PNG, JPG, WebP, or WOFF2 media
- Accepted output: trusted HTML shells and fixed-build JS/CSS/media assets
- Page metadata and tenant/public identifiers come from server configuration
- The browser supplies an active sandbox identifier and chooses one configured site key; the server fixes all site and tenant IDs
- The publisher request refuses redirects and requires HTTPS outside localhost

The bounded request keeps the pilot below the publisher's 6 MiB body limit after base64 encoding. A production version should use a publisher-created upload session with per-file signed uploads rather than increasing this limit.

## Dedicated Elite Assist target

The builder reads `AIDAOS_ELITE_ASSIST_TARGET_JSON` with exactly `agencyId`, `subAccountId`, `projectId`, `siteId`, `publicId`, `title`, and `description`; `publicId` must be `elite-assist`. It uses `AIDAOS_ELITE_ASSIST_PUBLISHING_TOKEN` and sends `x-aidaos-import-target: elite-assist`. The publisher stores the distinct token and `AIDAOS_ELITE_ASSIST_IMPORT_TARGET_JSON` with the same five site/tenant IDs plus `actorUid`. The default pilot token cannot select Elite Assist, and the Elite Assist token cannot select the pilot. Keep these values in provider secret storage; they never enter source or the build sandbox.

## Rollout gates

1. Deploy the trusted publisher endpoint in the isolated aidaOS publishing project.
2. Verify exact contract parity with `aida-generated-page-pilot-v1` over the live path.
3. Run an adversarial review covering source imports, build output, redirects, token handling, replay, cross-tenant writes, and publication races.
4. Enable the browser trigger only after that review passes.
