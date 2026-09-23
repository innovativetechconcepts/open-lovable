import { AidaosAdapterError, type PublishTarget } from "./publishing-adapter";

export type PublishTargetKey = "pilot" | "elite-assist";

const TARGET_FIELDS = [
  "agencyId", "subAccountId", "projectId", "siteId", "publicId",
  "title", "description",
] as const;
const INTERNAL_ID = /^[A-Za-z0-9_-]{1,128}$/;

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

export function resolvePublishTargetKey(value: unknown): PublishTargetKey {
  if (value === undefined || value === "pilot") return "pilot";
  if (value === "elite-assist") return "elite-assist";
  throw new AidaosAdapterError("invalid_target", "Choose a configured site.");
}

export function configuredPublishTarget(key: PublishTargetKey): PublishTarget {
  if (key === "pilot") {
    return {
      agencyId: required("AIDAOS_AGENCY_ID"),
      subAccountId: required("AIDAOS_SUBACCOUNT_ID"),
      projectId: required("AIDAOS_PROJECT_ID"),
      siteId: required("AIDAOS_SITE_ID"),
      publicId: required("AIDAOS_PUBLIC_ID"),
      title: process.env.AIDAOS_PAGE_TITLE?.trim() || "Generated with aidaOS",
      description: process.env.AIDAOS_PAGE_DESCRIPTION?.trim() ||
        "A page generated in an isolated aidaOS builder.",
    };
  }
  try {
    const parsed = JSON.parse(required("AIDAOS_ELITE_ASSIST_TARGET_JSON")) as Record<string, unknown>;
    if (
      !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).length !== TARGET_FIELDS.length ||
      Object.keys(parsed).some((field) => !TARGET_FIELDS.includes(field as typeof TARGET_FIELDS[number])) ||
      TARGET_FIELDS.some((field) => typeof parsed[field] !== "string" || !parsed[field]) ||
      TARGET_FIELDS.slice(0, 5).some((field) => !INTERNAL_ID.test(parsed[field] as string)) ||
      parsed.publicId !== "elite-assist"
    ) throw new Error("Invalid fixed target");
    return parsed as unknown as PublishTarget;
  } catch {
    throw new AidaosAdapterError(
      "publisher_not_configured",
      "Elite Assist target configuration is unavailable.",
      503,
    );
  }
}

export function publisherAuthorization(key: PublishTargetKey): {
  token: string;
  targetHeader: string | null;
} {
  return key === "elite-assist"
    ? { token: required("AIDAOS_ELITE_ASSIST_PUBLISHING_TOKEN"), targetHeader: key }
    : { token: required("AIDAOS_PUBLISHING_TOKEN"), targetHeader: null };
}

export function assertTargetActionEnabled(key: PublishTargetKey, action: "preview" | "publish"): void {
  if (key !== "elite-assist") return;
  if (process.env.AIDAOS_ELITE_ASSIST_PREVIEW_ENABLED !== "true") {
    throw new AidaosAdapterError("publisher_disabled", "Elite Assist preview is not enabled.", 404);
  }
  if (action === "publish" && process.env.AIDAOS_ELITE_ASSIST_PUBLICATION_ENABLED !== "true") {
    throw new AidaosAdapterError("publisher_publication_disabled", "Elite Assist publication is not enabled.", 403);
  }
}
