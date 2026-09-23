import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTargetActionEnabled,
  configuredPublishTarget,
  publisherAuthorization,
  resolvePublishTargetKey,
} from "../lib/aidaos/publish-target";

test("a configured Elite Assist site has separate publisher authority and stays preview-only", () => {
  const prior = Object.fromEntries(
    [
      "AIDAOS_ELITE_ASSIST_TARGET_JSON",
      "AIDAOS_ELITE_ASSIST_PUBLISHING_TOKEN",
      "AIDAOS_ELITE_ASSIST_PREVIEW_ENABLED",
      "AIDAOS_ELITE_ASSIST_PUBLICATION_ENABLED",
      "AIDAOS_PUBLISHING_TOKEN",
    ].map((name) => [name, process.env[name]]),
  );
  try {
    process.env.AIDAOS_ELITE_ASSIST_TARGET_JSON = JSON.stringify({
      agencyId: "PilotAgencyA", subAccountId: "PilotTenantA",
      projectId: "elite-assist-project", siteId: "elite-assist-site",
      publicId: "elite-assist", title: "Elite Assist review",
      description: "Private page review",
    });
    process.env.AIDAOS_PUBLISHING_TOKEN = "pilot-token";
    process.env.AIDAOS_ELITE_ASSIST_PUBLISHING_TOKEN = "elite-token";
    process.env.AIDAOS_ELITE_ASSIST_PREVIEW_ENABLED = "true";
    delete process.env.AIDAOS_ELITE_ASSIST_PUBLICATION_ENABLED;
    assert.equal(resolvePublishTargetKey(undefined), "pilot");
    assert.equal(resolvePublishTargetKey("elite-assist"), "elite-assist");
    assert.throws(() => resolvePublishTargetKey("other"), {code: "invalid_target"});
    assert.equal(configuredPublishTarget("elite-assist").publicId, "elite-assist");
    assert.deepEqual(publisherAuthorization("elite-assist"), {
      token: "elite-token", targetHeader: "elite-assist",
    });
    assert.deepEqual(publisherAuthorization("pilot"), {
      token: "pilot-token", targetHeader: null,
    });
    assert.doesNotThrow(() => assertTargetActionEnabled("elite-assist", "preview"));
    assert.throws(() => assertTargetActionEnabled("elite-assist", "publish"), {
      code: "publisher_publication_disabled",
    });
    process.env.AIDAOS_ELITE_ASSIST_TARGET_JSON = JSON.stringify({
      agencyId: "PilotAgencyA", subAccountId: "PilotTenantA",
      projectId: "elite-assist-project", siteId: "elite-assist-site",
      publicId: "open-lovable-pilot", title: "Wrong", description: "Wrong",
    });
    assert.throws(() => configuredPublishTarget("elite-assist"), {
      code: "publisher_not_configured",
    });
  } finally {
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
