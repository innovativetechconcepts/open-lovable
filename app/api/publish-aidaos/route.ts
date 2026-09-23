import { pilotRoute } from '@/lib/aidaos/pilot-route';
import { NextResponse } from "next/server";
import { sandboxManager } from "@/lib/sandbox/sandbox-manager";
import {
  AidaosAdapterError,
  buildPublishBundle,
  AIDAOS_ADAPTER_VERSION,
} from "@/lib/aidaos/publishing-adapter";
import {
  assertTargetActionEnabled,
  configuredPublishTarget,
  publisherAuthorization,
  resolvePublishTargetKey,
} from "@/lib/aidaos/publish-target";

export const maxDuration = 300;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AidaosAdapterError(
      "publisher_not_configured",
      `Server configuration ${name} is unavailable.`,
      503,
    );
  }
  return value;
}

function publishingEndpoint(): URL {
  const endpoint = new URL(required("AIDAOS_PUBLISHING_ENDPOINT"));
  if (
    endpoint.protocol !== "https:" &&
    !(
      endpoint.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(endpoint.hostname)
    )
  ) {
    throw new AidaosAdapterError(
      "publisher_not_configured",
      "The aidaOS publishing endpoint must use HTTPS.",
      503,
    );
  }
  return endpoint;
}

async function handlePOST(request: Request) {
  try {
    if (process.env.AIDAOS_PUBLISHING_ENABLED !== "true") {
      throw new AidaosAdapterError(
        "publisher_disabled",
        "aidaOS publishing is not enabled for this deployment.",
        404,
      );
    }
    const text = await request.text();
    if (Buffer.byteLength(text) > 4096) throw new AidaosAdapterError("invalid_request", "Request is too large.", 413);
    const body = JSON.parse(text) as {sandboxId?: unknown; action?: unknown; requestId?: unknown; jobId?: unknown; expectedVersion?: unknown; target?: unknown};
    if (body.action !== "preview" && body.action !== "publish") throw new AidaosAdapterError("invalid_action", "Choose Preview or Publish.");
    const targetKey = resolvePublishTargetKey(body.target);
    assertTargetActionEnabled(targetKey, body.action);
    let payload: unknown;
    if (body.action === "preview") {
      if (typeof body.sandboxId !== "string" || typeof body.requestId !== "string" || !/^[a-f0-9]{32}$/.test(body.requestId)) throw new AidaosAdapterError("invalid_sandbox", "A sandbox and preview request identifier are required.");
      const provider = await sandboxManager.getOrCreateProvider(body.sandboxId);
      const target = configuredPublishTarget(targetKey);
      payload = await buildPublishBundle({provider, target, identity: {
        agencyId: target.agencyId, subAccountId: target.subAccountId, projectId: target.projectId, siteId: target.siteId, publicId: target.publicId,
        releaseId: `release-${body.requestId}`, artifactId: `artifact-${body.requestId}`, jobId: `job-${body.requestId}`,
      }});
    } else {
      if (typeof body.jobId !== "string" || !/^job-[a-f0-9]{32}$/.test(body.jobId) || !Number.isSafeInteger(body.expectedVersion)) throw new AidaosAdapterError("invalid_draft", "A previewed draft is required.");
      payload = {action: "publish", jobId: body.jobId, expectedVersion: body.expectedVersion};
    }
    const publisherAuth = publisherAuthorization(targetKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 270_000);
    let response: Response;
    try {
      response = await fetch(publishingEndpoint(), {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${publisherAuth.token}`,
          "content-type": "application/json",
          "x-aidaos-adapter-version": AIDAOS_ADAPTER_VERSION,
          ...(publisherAuth.targetHeader ? { "x-aidaos-import-target": publisherAuth.targetHeader } : {}),
        },
        body: JSON.stringify(payload),
      });
    } finally {
      clearTimeout(timeout);
    }
    const result = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok) {
      throw new AidaosAdapterError(
        "publisher_rejected_bundle",
        typeof result?.error === "string"
          ? result.error
          : "The trusted publisher rejected the generated page.",
        response.status >= 400 && response.status < 600 ? response.status : 502,
      );
    }
    return NextResponse.json({
      success: true,
      publicUrl: result?.publicUrl,
      previewUrl: result?.previewUrl,
      releaseId: result?.releaseId,
      jobId: result?.jobId,
      expectedVersion: result?.expectedVersion,
      publicationVersion: result?.publicationVersion,
    });
  } catch (error) {
    const known = error instanceof AidaosAdapterError;
    return NextResponse.json(
      {
        success: false,
        code: known ? error.code : "publish_failed",
        error: known ? error.message : "Publishing failed.",
      },
      { status: known ? error.status : 500 },
    );
  }
}

export const POST = pilotRoute(handlePOST);
