import { NextResponse } from "next/server";
import { sandboxManager } from "@/lib/sandbox/sandbox-manager";
import {
  AidaosAdapterError,
  buildPublishBundle,
  type PublishTarget,
} from "@/lib/aidaos/publishing-adapter";

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
    !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname))
  ) {
    throw new AidaosAdapterError(
      "publisher_not_configured",
      "The aidaOS publishing endpoint must use HTTPS.",
      503,
    );
  }
  return endpoint;
}

function configuredTarget(): PublishTarget {
  return {
    agencyId: required("AIDAOS_AGENCY_ID"),
    subAccountId: required("AIDAOS_SUBACCOUNT_ID"),
    projectId: required("AIDAOS_PROJECT_ID"),
    siteId: required("AIDAOS_SITE_ID"),
    publicId: required("AIDAOS_PUBLIC_ID"),
    title: process.env.AIDAOS_PAGE_TITLE?.trim() || "Generated with aidaOS",
    description:
      process.env.AIDAOS_PAGE_DESCRIPTION?.trim() ||
      "A page generated in an isolated aidaOS builder.",
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sandboxId?: unknown };
    if (typeof body.sandboxId !== "string" || !body.sandboxId.trim()) {
      throw new AidaosAdapterError(
        "invalid_sandbox",
        "A sandbox identifier is required.",
      );
    }
    const provider = sandboxManager.getProvider(body.sandboxId);
    if (!provider) {
      throw new AidaosAdapterError(
        "sandbox_not_found",
        "The isolated builder session is no longer available.",
        404,
      );
    }
    const bundle = await buildPublishBundle({
      provider,
      target: configuredTarget(),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(publishingEndpoint(), {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${required("AIDAOS_PUBLISHING_TOKEN")}`,
          "content-type": "application/json",
          "x-aidaos-adapter-version": bundle.version,
        },
        body: JSON.stringify(bundle),
      });
    } finally {
      clearTimeout(timeout);
    }
    const result = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
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
      releaseId: bundle.identity.releaseId,
    });
  } catch (error) {
    const known = error instanceof AidaosAdapterError;
    return NextResponse.json(
      {
        success: false,
        code: known ? error.code : "publish_failed",
        error: error instanceof Error ? error.message : "Publishing failed.",
      },
      { status: known ? error.status : 500 },
    );
  }
}

