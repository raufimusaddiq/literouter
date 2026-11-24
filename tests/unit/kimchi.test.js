import { describe, it, beforeAll } from "bun:test";
import assert from "node:assert/strict";
import { normalizeKimchiModel } from "../../open-sse/services/kimchiModels.js";
import { findExistingOAuth } from "../../src/lib/db/repos/connectionsRepo.js";

let kimchiEntry;

describe("kimchi registry entry", () => {
  beforeAll(async () => {
    kimchiEntry = (await import("../../open-sse/providers/registry/kimchi.js")).default;
  });

  it("is an oauth-authenticated free-tier provider", () => {
    assert.equal(kimchiEntry.id, "kimchi");
    assert.equal(kimchiEntry.category, "freeTier");
  });

  it("points at the OpenAI-compatible gateway with an authenticated UA", () => {
    assert.equal(
      kimchiEntry.transport.baseUrl,
      "https://llm.kimchi.dev/openai/v1/chat/completions",
    );
    const ua = kimchiEntry.transport.headers["User-Agent"];
    assert.ok(typeof ua === "string" && ua.length > 0, `User-Agent missing: ${ua}`);
  });

  it("uses Bearer auth", () => {
    assert.deepEqual(kimchiEntry.transport.auth, {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    });
  });

  it("exposes the upstream static models", () => {
    const ids = kimchiEntry.models.map((m) => m.id);
    assert.ok(ids.includes("kimi-k2.7"));
    assert.ok(ids.includes("minimax-m3"));
    assert.ok(ids.includes("nemotron-3-ultra-fp4"));
    assert.ok(ids.length >= 5, `expected >= 5 static models, got ${ids.length}`);
  });

  it("passes through models not in the static list", () => {
    assert.equal(kimchiEntry.passthroughModels, true);
  });
});


describe("normalizeKimchiModel", () => {
  it("maps Kimchi metadata to the model shape", () => {
    const raw = {
      slug: "glm-5.2-fp8",
      display_name: "GLM 5.2",
      reasoning: true,
      limits: { context_window: 1048576, max_output_tokens: 1048576 },
    };
    const model = normalizeKimchiModel(raw);
    assert.equal(model.id, "glm-5.2-fp8");
    assert.equal(model.name, "GLM 5.2");
    assert.equal(model.contextLength, 1048576);
    assert.equal(model.maxOutputTokens, 1048576);
    assert.equal(model.reasoning, true);
    assert.equal(model.capabilities.vision, false);
  });

  it("falls back to slug as name when display_name is empty", () => {
    const model = normalizeKimchiModel({ slug: "kimi-k2.7", display_name: "", reasoning: false, limits: {} });
    assert.equal(model.name, "kimi-k2.7");
    assert.equal(model.contextLength, undefined);
    assert.equal(model.reasoning, false);
  });

  it("returns null for entries without an id", () => {
    assert.equal(normalizeKimchiModel(null), null);
    assert.equal(normalizeKimchiModel({}), null);
  });
});

describe("kimchi OAuth dedup", () => {
  const google = { authType: "oauth", email: "x@y.com", providerSpecificData: { username: "google-oauth2|123" } };
  const hf = { authType: "oauth", email: "x@y.com", providerSpecificData: { username: "huggingface|456" } };
  const legacy = { authType: "oauth", email: "x@y.com", providerSpecificData: {} };
  const other = { authType: "oauth", email: "z@y.com", providerSpecificData: { username: "google-oauth2|789" } };

  it("different email never matches", () => {
    assert.equal(findExistingOAuth([other], google), undefined);
  });

  it("same email + same username = dedup (re-login same IdP)", () => {
    const found = findExistingOAuth([google], { ...google });
    assert.equal(found, google);
  });

  it("same email + different username = NO match (cross-IdP, the bug)", () => {
    assert.equal(findExistingOAuth([google], hf), undefined);
  });

  it("legacy row without username matches incoming without username (backward compat)", () => {
    assert.equal(findExistingOAuth([legacy], { ...legacy }), legacy);
  });

  it("incoming without username does not match legacy row with username", () => {
    assert.equal(findExistingOAuth([google], { ...legacy }), undefined);
  });

  it("workspaces still dedupe on workspace ID when both sides have one", () => {
    const ws1 = { authType: "oauth", email: "a@b.com", providerSpecificData: { chatgptAccountId: "ws1" } };
    const ws1dup = { authType: "oauth", email: "a@b.com", providerSpecificData: { chatgptAccountId: "ws1" } };
    const ws2 = { authType: "oauth", email: "a@b.com", providerSpecificData: { chatgptAccountId: "ws2" } };
    assert.equal(findExistingOAuth([ws1], ws1dup), ws1);
    assert.equal(findExistingOAuth([ws1], ws2), undefined);
  });

  it("codex dedupes on workspace ID only", () => {
    const ws1 = { authType: "oauth", provider: "codex", email: "a@b.com", providerSpecificData: { chatgptAccountId: "ws1" } };
    const ws1dup = { ...ws1, providerSpecificData: { chatgptAccountId: "ws1" } };
    const ws2 = { ...ws1, providerSpecificData: { chatgptAccountId: "ws2" } };
    assert.equal(findExistingOAuth([ws1], ws1dup), ws1);
    assert.equal(findExistingOAuth([ws1], ws2), undefined);
  });

  it("codex without a workspace ID never matches, even on the same email", () => {
    const noWs = { authType: "oauth", provider: "codex", email: "a@b.com", providerSpecificData: {} };
    assert.equal(findExistingOAuth([noWs], { ...noWs }), undefined);
  });
});
